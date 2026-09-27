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

// Real runAgentLoop, with only the same three seams agentLoop.test.ts mocks faked.
// streamAgentTurn (Nebius) is genuinely live in every case below (issue #3).
vi.mock('../background/history/sessionHistory', () => ({
  getExtractedPage: vi.fn(),
  getFullPageContent: vi.fn(),
  getHistory: vi.fn(),
  appendHistoryTurns: vi.fn(),
}))
vi.mock('../background/keys', () => ({ getApiKeys: vi.fn() }))
vi.mock('../background/tavily/client', () => ({ searchTavily: vi.fn(), extractTavily: vi.fn() }))

// A fake, non-empty Tavily key: search_site/fetch_page just need to be *offered*
// (searchEnabled = Boolean(tavilyApiKey)); the mocked tavily/client above means the
// real Tavily API is never called in this file, so the value itself is never sent
// anywhere.
const FAKE_TAVILY_KEY = 'eval-fake-tavily-key'

afterAll(() => {
  printSummary()
})

describe('on-page: answerable from the page alone', () => {
  // No Tavily key: matches how ADR 0005/0006's own real-page diagnostics were run,
  // and makes "no tool but cite_page could possibly run" a structural fact, not just
  // an assertion below.
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
      // Soft, not hard: ADR 0005 measured this at 0/7 on the fixture, but a stray
      // cite_page digression that still lands on the right label is not a regression
      // worth failing the run over — logged for the summary, not asserted on.
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
      // Not always 'page+web': confirmed live (2026-09-27) the model sometimes answers
      // the page-side fact from its own reading of the page content without calling
      // cite_page for it (ADR 0005: absence of a tool call is not evidence of page
      // grounding, so that half of the answer correctly earns no credit) — 'web' alone
      // is still correct there, just less complete provenance, not a wrong answer.
      expect(['web', 'page+web'], JSON.stringify(turn)).toContain(turn?.source)
      // Only checked when a page quote is actually claimed: cite_page lets the model quote
      // any verbatim span it chooses, not necessarily the whole BETA_TESTER_QUOTE sentence
      // — confirmed live it reliably quotes a shorter or longer real substring instead
      // (e.g. "2,400 beta testers"). verifyQuotes already guarantees anything in
      // turn.quotes is a real substring of the page; checking for the key figure is what
      // actually matters here.
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
