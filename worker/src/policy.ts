// What the demo proxy will forward, kept free of Worker APIs so it runs under plain Vitest.
// The proxy holds paid keys, so anything the extension doesn't send is refused: it must not
// become a general-purpose LLM or search endpoint.

export type Bucket = 'nebius' | 'tavily'

export interface Limits {
  /** Calls per install ID per UTC day. */
  perInstall: number
  /** Calls per client IP per UTC day; looser, since a shared network is one IP. Stops ID minting. */
  perIp: number
  /** Calls across everyone per UTC day: the real spend cap. */
  global: number
}

// One chat call is one agent round; a question takes 1 to ~6. Tavily is one call per search or fetch.
export const DEFAULT_LIMITS: Record<Bucket, Limits> = {
  nebius: { perInstall: 150, perIp: 400, global: 3000 },
  tavily: { perInstall: 40, perIp: 120, global: 600 },
}

export const MAX_BODY_BYTES = 2_000_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isInstallId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export type Route =
  | { kind: 'nebius-models' }
  | { kind: 'nebius-chat' }
  | { kind: 'tavily-search' }
  | { kind: 'tavily-extract' }

export function routeFor(method: string, pathname: string): Route | undefined {
  if (method === 'GET' && pathname === '/nebius/models') return { kind: 'nebius-models' }
  if (method !== 'POST') return undefined
  if (pathname === '/nebius/chat/completions') return { kind: 'nebius-chat' }
  if (pathname === '/tavily/search') return { kind: 'tavily-search' }
  if (pathname === '/tavily/extract') return { kind: 'tavily-extract' }
  return undefined
}

export function bucketOf(route: Route): Bucket | undefined {
  if (route.kind === 'nebius-chat') return 'nebius'
  if (route.kind === 'tavily-search' || route.kind === 'tavily-extract') return 'tavily'
  return undefined
}

type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// Nemotron only, which is all the extension asks for (ADR 0002).
export function checkChatBody(body: unknown): Checked<Record<string, unknown>> {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object.' }
  if (typeof body.model !== 'string' || !/nemotron/i.test(body.model)) return { ok: false, error: 'Only Nemotron models are available in demo mode.' }
  if (!Array.isArray(body.messages) || body.messages.length === 0) return { ok: false, error: 'messages is required.' }
  return { ok: true, value: body }
}

// Rebuilt from the fields the extension sets, so the caller can't add options (a different
// search_depth, more results, raw content). The upstream key is added by the caller.
export function checkTavilySearch(body: unknown): Checked<{ query: string; search_depth: string; max_results: number; include_domains: string[] }> {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object.' }
  const { query, include_domains: domains, search_depth: depth, max_results: max } = body
  if (typeof query !== 'string' || !query.trim() || query.length > 1000) return { ok: false, error: 'query is required (max 1000 chars).' }
  if (!Array.isArray(domains) || domains.length !== 1 || typeof domains[0] !== 'string') return { ok: false, error: 'Exactly one include_domains entry is required.' }
  return {
    ok: true,
    value: {
      query,
      search_depth: depth === 'basic' ? 'basic' : 'advanced',
      max_results: typeof max === 'number' ? Math.min(Math.max(Math.floor(max), 1), 5) : 5,
      include_domains: [domains[0]],
    },
  }
}

export function checkTavilyExtract(body: unknown): Checked<{ urls: string[] }> {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object.' }
  const { urls } = body
  if (!Array.isArray(urls) || urls.length !== 1 || typeof urls[0] !== 'string') return { ok: false, error: 'Exactly one URL is required.' }
  try {
    const { protocol } = new URL(urls[0])
    if (protocol !== 'http:' && protocol !== 'https:') throw new Error()
  } catch {
    return { ok: false, error: 'urls[0] must be an http(s) URL.' }
  }
  return { ok: true, value: { urls: [urls[0]] } }
}

export type LimitScope = 'install' | 'ip' | 'global'

export function limitMessage(scope: LimitScope): string {
  return scope === 'global'
    ? "Sift's shared demo has hit its daily limit. Add your own API keys in Options to keep going, or try again tomorrow (UTC)."
    : "You've used today's share of Sift's shared demo. Add your own API keys in Options to keep going, or try again tomorrow (UTC)."
}
