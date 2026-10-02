import { DurableObject } from 'cloudflare:workers'
import {
  DEFAULT_LIMITS,
  MAX_BODY_BYTES,
  bucketOf,
  checkChatBody,
  checkTavilyExtract,
  checkTavilySearch,
  isInstallId,
  limitMessage,
  routeFor,
  type Bucket,
  type LimitScope,
  type Limits,
} from './policy'

interface Env {
  LIMITER: DurableObjectNamespace<Limiter>
  NEBIUS_API_KEY: string
  TAVILY_API_KEY: string
  NEBIUS_BASE_URL?: string
  // e.g. NEBIUS_PER_INSTALL=100: overrides DEFAULT_LIMITS without a code change.
  [limitVar: string]: unknown
}

const NEBIUS_DEFAULT_BASE = 'https://api.tokenfactory.nebius.com/v1'
const TAVILY_BASE = 'https://api.tavily.com'

// Sift calls from a service worker with host permission, so CORS isn't needed there; it is
// here so the options page or a test page can reach the proxy too.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } })
}

function limitsFor(env: Env, bucket: Bucket): Limits {
  const base = DEFAULT_LIMITS[bucket]
  const read = (suffix: string, fallback: number) => {
    const n = Number(env[`${bucket.toUpperCase()}_${suffix}`])
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return { perInstall: read('PER_INSTALL', base.perInstall), perIp: read('PER_IP', base.perIp), global: read('GLOBAL', base.global) }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    const url = new URL(request.url)
    const route = routeFor(request.method, url.pathname)
    if (!route) return json(404, { error: 'not_found' })

    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return json(413, { error: 'too_large' })

    let body: unknown
    if (request.method === 'POST') {
      try {
        body = await request.json()
      } catch {
        return json(400, { error: 'bad_json' })
      }
    }

    // The extension sends its install ID where the real API would take a key: as the bearer
    // token for Nebius, as `api_key` in the body for Tavily. Neither is a secret.
    const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    const installId = route.kind.startsWith('tavily') ? (body as { api_key?: unknown } | undefined)?.api_key : bearer
    if (!isInstallId(installId)) return json(401, { error: 'bad_install_id' })

    let upstream: { url: string; init: RequestInit }
    if (route.kind === 'nebius-models') {
      upstream = { url: `${env.NEBIUS_BASE_URL ?? NEBIUS_DEFAULT_BASE}/models`, init: { headers: { Authorization: `Bearer ${env.NEBIUS_API_KEY}` } } }
    } else if (route.kind === 'nebius-chat') {
      const checked = checkChatBody(body)
      if (!checked.ok) return json(400, { error: 'bad_request', message: checked.error })
      upstream = {
        url: `${env.NEBIUS_BASE_URL ?? NEBIUS_DEFAULT_BASE}/chat/completions`,
        init: { method: 'POST', headers: { Authorization: `Bearer ${env.NEBIUS_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(checked.value) },
      }
    } else {
      const checked = route.kind === 'tavily-search' ? checkTavilySearch(body) : checkTavilyExtract(body)
      if (!checked.ok) return json(400, { error: 'bad_request', message: checked.error })
      const path = route.kind === 'tavily-search' ? '/search' : '/extract'
      upstream = {
        url: `${TAVILY_BASE}${path}`,
        init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...checked.value, api_key: env.TAVILY_API_KEY }) },
      }
    }

    const bucket = bucketOf(route)
    if (bucket) {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
      const verdict = await env.LIMITER.getByName('global').consume(bucket, installId, ip, limitsFor(env, bucket))
      if (!verdict.ok) {
        // The header is how the extension tells this 429 apart from an upstream one.
        return json(429, { error: 'demo_limit', scope: verdict.scope, message: limitMessage(verdict.scope) }, { 'X-Sift-Demo-Limit': verdict.scope })
      }
    }

    const res = await fetch(upstream.url, upstream.init)
    return new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json', ...CORS },
    })
  },
}

// One instance counts everything: calls are serialised, so a check and its increment can't
// race, and the traffic here is nowhere near what a single object handles.
export class Limiter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, key))')
  }

  consume(bucket: Bucket, installId: string, ip: string, limits: Limits): { ok: true } | { ok: false; scope: LimitScope } {
    const sql = this.ctx.storage.sql
    const day = new Date().toISOString().slice(0, 10)
    sql.exec('DELETE FROM usage WHERE day < ?', day)

    const keys: [LimitScope, string, number][] = [
      ['global', `global:${bucket}`, limits.global],
      ['install', `install:${bucket}:${installId}`, limits.perInstall],
      ['ip', `ip:${bucket}:${ip}`, limits.perIp],
    ]
    const used = (key: string) => (sql.exec<{ n: number }>('SELECT n FROM usage WHERE day = ? AND key = ?', day, key).toArray()[0]?.n ?? 0)

    for (const [scope, key, max] of keys) {
      if (used(key) >= max) return { ok: false, scope }
    }
    for (const [, key] of keys) {
      sql.exec('INSERT INTO usage (day, key, n) VALUES (?, ?, 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1', day, key)
    }
    return { ok: true }
  }
}
