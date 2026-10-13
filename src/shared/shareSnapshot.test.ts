import { describe, expect, it } from 'vitest'
import { SHARE_FRAGMENT_CHAR_LIMIT } from './constants'
import { buildShareLink, decodeSnapshot, pairTurns } from './shareSnapshot'
import type { ChatTurn } from './types'

const LANDING = 'https://example.github.io/sift/'
const PAGE = 'https://a.com/post?x=1&y=2'

const user = (content: string, extra: Partial<ChatTurn> = {}): ChatTurn => ({ role: 'user', content, ...extra })
const assistant = (content: string, extra: Partial<ChatTurn> = {}): ChatTurn => ({
  role: 'assistant',
  content,
  ...extra,
})

// Incompressible text, so size tracks length.
const noise = (n: number) => Array.from({ length: n }, () => Math.random().toString(36).slice(2)).join('')

const hashOf = (link: string) => link.slice(link.indexOf('#'))

describe('pairTurns', () => {
  it('drops everything but question, answer, source and quotes', () => {
    const pairs = pairTurns([
      user('Who?', { selection: 'sel' }),
      assistant('Dana', {
        source: 'page',
        quotes: ['Dana Reyes'],
        url: PAGE,
        truncated: true,
        charsOmitted: 5,
        steps: [],
        stats: { durationMs: 1, toolRounds: 0 },
        webPages: { read: [], found: [] },
      }),
    ])
    expect(pairs).toEqual([{ question: 'Who?', answer: 'Dana', source: 'page', quotes: ['Dana Reyes'] }])
  })

  it('omits empty quotes and absent source', () => {
    expect(pairTurns([user('q'), assistant('a', { quotes: [] })])).toEqual([{ question: 'q', answer: 'a' }])
  })

  it('ignores an unanswered final question', () => {
    expect(pairTurns([user('q1'), assistant('a1'), user('q2')])).toHaveLength(1)
  })

  it('skips an assistant turn with no question before it', () => {
    expect(pairTurns([assistant('stray'), user('q'), assistant('a')])).toEqual([{ question: 'q', answer: 'a' }])
  })
})

describe('buildShareLink', () => {
  it('round-trips through decodeSnapshot', async () => {
    const turns = [user('Who wrote it? ✓'), assistant('Dana — "quoted"', { source: 'web', quotes: ['a b'] })]
    const { link, sharedPairs, droppedPairs } = await buildShareLink(turns, LANDING, PAGE)
    expect([sharedPairs, droppedPairs]).toEqual([1, 0])
    const decoded = await decodeSnapshot(hashOf(link!))
    expect(decoded).toEqual({ ok: true, pageUrl: PAGE, pairs: pairTurns(turns) })
  })

  it('uses only URL-safe characters in the data', async () => {
    const { link } = await buildShareLink([user('???>>>'), assistant('~~~ ÿÿÿ')], LANDING, PAGE)
    expect(link!.startsWith(`${LANDING}#u=`)).toBe(true)
    expect(link!.split('&d=')[1]).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('keeps the last pairs that fit and reports the rest as dropped', async () => {
    const turns = Array.from({ length: 6 }, (_, i) => [user(`q${i}`), assistant(noise(300))]).flat()
    const { link, sharedPairs, droppedPairs } = await buildShareLink(turns, LANDING, PAGE)
    expect(sharedPairs).toBeGreaterThan(0)
    expect(droppedPairs).toBeGreaterThan(0)
    expect(sharedPairs + droppedPairs).toBe(6)
    expect(hashOf(link!).length - 1).toBeLessThanOrEqual(SHARE_FRAGMENT_CHAR_LIMIT)
    const decoded = await decodeSnapshot(hashOf(link!))
    expect(decoded.ok && decoded.pairs.at(-1)?.question).toBe('q5')
  })

  it('returns no link when a single pair is over the cap', async () => {
    const result = await buildShareLink([user('q'), assistant(noise(5000))], LANDING, PAGE)
    expect(result).toEqual({ link: null, sharedPairs: 0, droppedPairs: 1 })
  })

  it('returns no link for a thread with nothing answered', async () => {
    expect(await buildShareLink([user('q')], LANDING, PAGE)).toEqual({ link: null, sharedPairs: 0, droppedPairs: 0 })
  })
})

describe('decodeSnapshot', () => {
  it.each([
    ['empty', ''],
    ['missing data', '#u=https%3A%2F%2Fa.com'],
    ['not base64', '#u=https%3A%2F%2Fa.com&d=!!!'],
    ['not deflate', '#u=https%3A%2F%2Fa.com&d=aGVsbG8'],
  ])('returns an error for %s', async (_name, hash) => {
    expect((await decodeSnapshot(hash)).ok).toBe(false)
  })

  it('rejects well-formed data of another shape', async () => {
    const bytes = await new Response(
      new Blob([JSON.stringify({ v: 2, pairs: [] })]).stream().pipeThrough(new CompressionStream('deflate-raw')),
    ).arrayBuffer()
    const d = btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_')
    expect((await decodeSnapshot(`#u=x&d=${d}`)).ok).toBe(false)
  })
})
