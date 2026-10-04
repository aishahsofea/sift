import { afterAll, describe, expect, it, vi } from 'vitest'
import { getRepeatCount, printSummary, recordRun, runCase, stepKindsOf } from './harness'
import {
  authorEstablishedHistory,
  authorPostsResults,
  followUpQuestion,
  offPageQuestion,
  onPageQuestion,
  page,
  partialQuestion,
  pricingResults,
} from './fixtures/fictionalProductPage'

// Real runAgentLoop with the same three seams faked as agentLoop.test.ts; streamAgentTurn is live (issue #3).
vi.mock('../background/history/sessionHistory', () => ({
  getExtractedPage: vi.fn(),
  getFullPageContent: vi.fn(),
  getHistory: vi.fn(),
  appendHistoryTurns: vi.fn(),
}))
vi.mock('../background/history/agentTraces', () => ({
  getTraces: vi.fn(),
  appendTrace: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../background/keys', () => ({
  getApiKeys: vi.fn(),
  getTraceContentEnabled: vi.fn().mockResolvedValue(false),
}))
vi.mock('../background/tavily/client', () => ({ searchTavily: vi.fn(), extractTavily: vi.fn() }))

// Non-empty so search_site/fetch_page are offered; the mocked tavily/client means the key is never sent.
const FAKE_TAVILY_KEY = 'eval-fake-tavily-key'

afterAll(() => {
  printSummary()
})

describe('on-page: answerable from the page alone', () => {
  // No Tavily key, as in ADR 0005/0006's diagnostics, so only cite_page can run.
  for (let i = 0; i < getRepeatCount(); i++) {
    it(`cites the page and answers, run ${i + 1}`, async () => {
      const { turn, error, posted, elapsedMs } = await runCase({ page, question: onPageQuestion })
      const stepKinds = stepKindsOf(posted)
      recordRun({ category: 'on-page', label: onPageQuestion, turn, error, elapsedMs, stepKinds })

      expect(error, error).toBeUndefined()
      expect(turn?.source, JSON.stringify(turn)).toBe('page')
      expect(turn?.quotes?.length ?? 0, JSON.stringify(turn)).toBeGreaterThan(0)
      expect(stepKinds).not.toContain('searching')
      expect(stepKinds).not.toContain('reading')
      expect(stepKinds).not.toContain('scanning')
    })
  }
})

describe('off-page: needs a search', () => {
  for (let i = 0; i < getRepeatCount(); i++) {
    it(`searches and grounds the answer in the result, run ${i + 1}`, async () => {
      const { turn, error, posted, elapsedMs } = await runCase({
        page,
        question: offPageQuestion,
        tavilyApiKey: FAKE_TAVILY_KEY,
        searchResults: pricingResults,
      })
      const stepKinds = stepKindsOf(posted)
      recordRun({ category: 'off-page', label: offPageQuestion, turn, error, elapsedMs, stepKinds })

      expect(error, error).toBeUndefined()
      expect(turn?.source, JSON.stringify(turn)).toBe('web')
      expect(stepKinds).toContain('searching')
      // Soft: ADR 0005 measured 0/7, and a stray cite_page call that lands on the right label isn't worth failing; logged, not asserted.
      if (stepKinds.includes('citing')) {
        console.warn(`[eval] off-page run ${i + 1} called cite_page too (label was still ${turn?.source})`)
      }
    })
  }
})

describe('partial: needs the page and the web together', () => {
  for (let i = 0; i < getRepeatCount(); i++) {
    it(`combines a page quote with a search result, run ${i + 1}`, async () => {
      const { turn, error, posted, elapsedMs } = await runCase({
        page,
        question: partialQuestion,
        tavilyApiKey: FAKE_TAVILY_KEY,
        searchResults: pricingResults,
      })
      const stepKinds = stepKindsOf(posted)
      recordRun({ category: 'partial', label: partialQuestion, turn, error, elapsedMs, stepKinds })

      expect(error, error).toBeUndefined()
      // 'web' alone is also correct: the model sometimes answers the page fact without cite_page (live 2026-09-27), which earns no page credit (ADR 0005).
      expect(['web', 'page+web'], JSON.stringify(turn)).toContain(turn?.source)
      // Only when a page quote is claimed: the model quotes a shorter or longer real substring (e.g. "2,400 beta testers"), so check the key figure, not the whole sentence.
      if (turn?.source === 'page+web') {
        expect(turn?.quotes?.some((q) => q.includes('2,400')), JSON.stringify(turn)).toBe(true)
      }
      expect(stepKinds).toContain('searching')
    })
  }
})

describe('follow-up: a pronoun question resolved from history', () => {
  for (let i = 0; i < getRepeatCount(); i++) {
    it(`writes a search query that resolves "she", run ${i + 1}`, async () => {
      const { turn, error, posted, elapsedMs } = await runCase({
        page,
        question: followUpQuestion,
        history: authorEstablishedHistory,
        tavilyApiKey: FAKE_TAVILY_KEY,
        searchResults: authorPostsResults,
      })
      const stepKinds = stepKindsOf(posted)
      recordRun({ category: 'follow-up', label: followUpQuestion, turn, error, elapsedMs, stepKinds })

      expect(error, error).toBeUndefined()
      expect(['web', 'page+web'], JSON.stringify(turn)).toContain(turn?.source)

      const searchStep = posted.find((m): m is Extract<typeof m, { type: 'ASK_STEP' }> => m.type === 'ASK_STEP' && m.step.kind === 'searching')
      expect(searchStep, 'expected a search_site call to resolve the follow-up').toBeDefined()
      const query = searchStep && searchStep.step.kind === 'searching' ? searchStep.step.query : ''
      expect(query.toLowerCase(), query).toContain('priya')
    })
  }
})
