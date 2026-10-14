import { SHARE_FRAGMENT_CHAR_LIMIT } from './constants'
import type { AnswerSource, ChatTurn } from './types'

export interface SharedPair {
  question: string
  answer: string
  source?: AnswerSource
  quotes?: string[]
}

export interface ShareSnapshot {
  pageUrl: string
  pairs: SharedPair[]
}

export interface ShareLink {
  /** Null when not even the last pair fits under the cap. */
  link: string | null
  sharedPairs: number
  droppedPairs: number
}

export type DecodedSnapshot = { ok: true; pageUrl: string; pairs: SharedPair[] } | { ok: false; error: string }

const FORMAT_VERSION = 1

export function pairTurns(turns: ChatTurn[]): SharedPair[] {
  const pairs: SharedPair[] = []
  for (let i = 0; i < turns.length - 1; i++) {
    const [q, a] = [turns[i], turns[i + 1]]
    if (q.role !== 'user' || a.role !== 'assistant') continue
    pairs.push({
      question: q.content,
      answer: a.content,
      ...(a.source && { source: a.source }),
      ...(a.quotes?.length && { quotes: a.quotes }),
    })
    i++
  }
  return pairs
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream))
  return new Uint8Array(await out.arrayBuffer())
}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))

async function encodePairs(pairs: SharedPair[]): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ v: FORMAT_VERSION, pairs }))
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))
}

export const isSharedPair = (p: unknown): p is SharedPair =>
  typeof p === 'object' &&
  p !== null &&
  typeof (p as SharedPair).question === 'string' &&
  typeof (p as SharedPair).answer === 'string'

/** Reads a landing-page hash (`#u=<page url>&d=<data>`); malformed input returns an error, never throws. */
export async function decodeSnapshot(hash: string): Promise<DecodedSnapshot> {
  try {
    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const pageUrl = params.get('u')
    const data = params.get('d')
    if (!pageUrl || !data) return { ok: false, error: 'The link is missing its page or its data.' }
    const bytes = await pipe(fromBase64Url(data) as Uint8Array<ArrayBuffer>, new DecompressionStream('deflate-raw'))
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    if (parsed?.v !== FORMAT_VERSION || !Array.isArray(parsed.pairs) || !parsed.pairs.every(isSharedPair)) {
      return { ok: false, error: 'The link was made by a different version of Sift.' }
    }
    return { ok: true, pageUrl, pairs: parsed.pairs }
  } catch {
    return { ok: false, error: 'The link is damaged and could not be read.' }
  }
}

/** Keeps the most recent pairs whose fragment fits under SHARE_FRAGMENT_CHAR_LIMIT. */
export async function buildShareLink(turns: ChatTurn[], landingUrl: string, pageUrl: string): Promise<ShareLink> {
  const pairs = pairTurns(turns)
  const prefix = `u=${encodeURIComponent(pageUrl)}&d=`
  for (let keep = pairs.length; keep > 0; keep--) {
    const fragment = prefix + (await encodePairs(pairs.slice(-keep)))
    if (fragment.length <= SHARE_FRAGMENT_CHAR_LIMIT) {
      return { link: `${landingUrl}#${fragment}`, sharedPairs: keep, droppedPairs: pairs.length - keep }
    }
  }
  return { link: null, sharedPairs: 0, droppedPairs: pairs.length }
}

// `url` is set so the panel's quote buttons can find the page the quotes came from.
export function pairsToTurns({ pageUrl, pairs }: ShareSnapshot): ChatTurn[] {
  return pairs.flatMap(({ question, answer, source, quotes }): ChatTurn[] => [
    { role: 'user', content: question },
    { role: 'assistant', content: answer, ...(source && { source }), ...(quotes && { quotes, url: pageUrl }) },
  ])
}
