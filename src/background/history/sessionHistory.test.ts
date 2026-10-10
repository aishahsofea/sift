import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pendingSelectionKey } from '../../shared/storageKeys'
import type { ExtractedPage } from '../../shared/types'
import {
  appendHistoryTurns,
  clearTabData,
  dropLastHistoryTurns,
  getExtractedPage,
  getFullPageContent,
  getHistory,
  setExtractedPage,
  setPendingSelection,
} from './sessionHistory'

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

const head: ExtractedPage = {
  url: 'https://example.com/long',
  title: 'A long page',
  content: 'The start of a long page.',
  extractionMethod: 'readability',
  truncated: true,
  charsOmitted: 40,
}
const whole: ExtractedPage = { ...head, truncated: false, charsOmitted: 0 }
const fullText = `${head.content} ${'and the rest of it. '.repeat(2)}`

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

describe('setExtractedPage', () => {
  it('keeps the whole text of a cut-short page beside its head, and says the page is searchable', async () => {
    const stored = await setExtractedPage(7, head, fullText)

    expect(stored).toEqual({ ...head, searchable: true })
    expect(await getExtractedPage(7)).toEqual(stored)
    expect(await getFullPageContent(7)).toBe(fullText)
  })

  it('keeps the whole text out of the page, so reading the page does not read it', async () => {
    await setExtractedPage(7, head, fullText)

    expect(JSON.stringify(await getExtractedPage(7))).not.toContain('and the rest of it')
  })

  it('keeps no second copy of a page that was whole', async () => {
    const stored = await setExtractedPage(7, whole)

    expect(stored.searchable).toBe(false)
    expect(await getFullPageContent(7)).toBeUndefined()
  })

  it('stores the head alone, unsearchable, when the page was too long to send whole', async () => {
    const stored = await setExtractedPage(7, head, undefined)

    expect(stored).toEqual({ ...head, searchable: false })
    expect(await getFullPageContent(7)).toBeUndefined()
  })

  it('falls back to the head alone when the whole text does not fit, instead of failing the extraction', async () => {
    quota = JSON.stringify({ ...head, searchable: false }).length + 20

    const stored = await setExtractedPage(7, head, fullText)

    expect(stored).toEqual({ ...head, searchable: false })
    expect(await getExtractedPage(7)).toEqual(stored)
    expect(await getFullPageContent(7)).toBeUndefined()
    expect(console.warn).toHaveBeenCalled()
  })

  it("replaces the previous page's text, which would otherwise be searched as this page's", async () => {
    await setExtractedPage(7, head, 'The text of the first page. '.repeat(3))
    await setExtractedPage(7, head, fullText)

    expect(await getFullPageContent(7)).toBe(fullText)
  })

  it('removes the previous long page text when the tab moves to a page that is whole', async () => {
    await setExtractedPage(7, head, fullText)
    await setExtractedPage(7, whole)

    expect(await getFullPageContent(7)).toBeUndefined()
  })

  it('removes the previous text when the new page does not fit, rather than leaving it to be searched', async () => {
    await setExtractedPage(7, head, 'The text of the first page. '.repeat(3))
    quota = size(store) + 5

    await setExtractedPage(7, head, fullText.repeat(20))

    expect(await getFullPageContent(7)).toBeUndefined()
    expect((await getExtractedPage(7))?.searchable).toBe(false)
  })

  it('keeps each tab its own text', async () => {
    await setExtractedPage(1, head, 'text of tab one ')
    await setExtractedPage(2, head, 'text of tab two ')

    expect(await getFullPageContent(1)).toBe('text of tab one ')
    expect(await getFullPageContent(2)).toBe('text of tab two ')
  })
})

describe('getFullPageContent', () => {
  it('is undefined for a tab with nothing kept', async () => {
    expect(await getFullPageContent(99)).toBeUndefined()
  })
})

describe('clearTabData', () => {
  it("removes a closed tab's page, whole text and history, and only that tab's", async () => {
    await setExtractedPage(1, head, fullText)
    await appendHistoryTurns(1, [{ role: 'user', content: 'q' }])
    await setPendingSelection(1, 'quoted')
    await setExtractedPage(2, head, fullText)
    await appendHistoryTurns(2, [{ role: 'user', content: 'q' }])

    await clearTabData(1)

    expect(store.has(pendingSelectionKey(1))).toBe(false)
    expect(await getExtractedPage(1)).toBeUndefined()
    expect(await getFullPageContent(1)).toBeUndefined()
    expect(await getHistory(1)).toEqual([])
    expect(await getExtractedPage(2)).toBeDefined()
    expect(await getFullPageContent(2)).toBe(fullText)
    expect(await getHistory(2)).toHaveLength(1)
  })
})

describe('dropLastHistoryTurns', () => {
  beforeEach(() => {
    store = new Map()
    quota = Infinity
    vi.stubGlobal('chrome', { storage: { session } })
  })

  it('drops from the end, and stops at empty', async () => {
    const turns = ['a', 'b', 'c', 'd'].map((content, i) => ({ role: i % 2 ? 'assistant' : 'user', content }) as const)
    await appendHistoryTurns(1, [...turns])
    expect((await dropLastHistoryTurns(1, 2)).map((t) => t.content)).toEqual(['a', 'b'])
    expect(await dropLastHistoryTurns(1, 9)).toEqual([])
    expect(await getHistory(1)).toEqual([])
  })
})
