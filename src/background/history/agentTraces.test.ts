import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TRACE_RUNS } from '../../shared/constants'
import type { AgentTrace } from '../../shared/types'
import { appendTrace, getTraces } from './agentTraces'

// A stand-in for chrome.storage.session: a map that, like the real one, refuses a write
// that would take it over its quota and writes nothing when it does.
let store: Map<string, unknown>
let quota: number

const size = (entries: Iterable<[string, unknown]>) => [...entries].reduce((sum, [, value]) => sum + JSON.stringify(value).length, 0)

const session = {
  async get(keys: string | string[]) {
    return Object.fromEntries([keys].flat().filter((key) => store.has(key)).map((key) => [key, store.get(key)]))
  },
  async set(items: Record<string, unknown>) {
    const next = new Map([...store, ...Object.entries(items)])
    if (size(next) > quota) throw new Error('QUOTA_BYTES quota exceeded')
    store = next
  },
  async remove(keys: string | string[]) {
    for (const key of [keys].flat()) store.delete(key)
  },
}

const trace = (id: string): AgentTrace => ({
  id,
  tabId: 7,
  startedAt: '2026-09-30T00:00:00.000Z',
  endedAt: '2026-09-30T00:00:01.000Z',
  status: 'done',
  extensionVersion: '0.1.0',
  question: { length: 10 },
  askedToQuote: false,
  forcedNudgeSent: false,
  forcedRetrySent: false,
  rounds: [],
})

beforeEach(() => {
  store = new Map()
  quota = Infinity
  vi.stubGlobal('chrome', { storage: { session } })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getTraces', () => {
  it('is empty when nothing has been recorded', async () => {
    expect(await getTraces()).toEqual([])
  })
})

describe('appendTrace', () => {
  it('adds a trace to the stored list', async () => {
    await appendTrace(trace('a'))

    expect(await getTraces()).toEqual([trace('a')])
  })

  it('grows as traces are appended, oldest first', async () => {
    await appendTrace(trace('a'))
    await appendTrace(trace('b'))

    expect(await getTraces()).toEqual([trace('a'), trace('b')])
  })

  it('caps at MAX_TRACE_RUNS, dropping the oldest first', async () => {
    for (let i = 0; i < MAX_TRACE_RUNS + 3; i++) {
      await appendTrace(trace(`t${i}`))
    }

    const stored = await getTraces()
    expect(stored).toHaveLength(MAX_TRACE_RUNS)
    expect(stored[0].id).toBe('t3')
    expect(stored.at(-1)?.id).toBe(`t${MAX_TRACE_RUNS + 2}`)
  })

  it('catches a quota failure and logs it, instead of rejecting', async () => {
    quota = 10

    await expect(appendTrace(trace('a'))).resolves.toBeUndefined()

    expect(await getTraces()).toEqual([])
    expect(console.warn).toHaveBeenCalled()
  })
})
