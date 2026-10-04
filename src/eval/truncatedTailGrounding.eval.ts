import { afterAll, describe, expect, it, vi } from 'vitest'
import { getRepeatCount, printSummary, recordRun, runCase, stepKindsOf } from './harness'
import {
  ABSTENTION_RE,
  assertFixtureIntegrity,
  falseAbstentionQuestion,
  FULL_TEXT,
  page,
  REAL_MECHANISM_RE,
  truncatedTailQuestion,
} from './fixtures/transformerCircuitsBiology'

// Real runAgentLoop with the usual three seams faked; Tavily is stubbed to throw, so a stray real call fails loudly.
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
vi.mock('../background/tavily/client', () => ({
  searchTavily: vi.fn(() => {
    throw new Error('searchTavily must never be called in truncatedTailGrounding.eval.ts: no case here has a Tavily key.')
  }),
  extractTavily: vi.fn(() => {
    throw new Error('extractTavily must never be called in truncatedTailGrounding.eval.ts: no case here has a Tavily key.')
  }),
}))

afterAll(() => {
  printSummary()
})

// Fails fast, with no API calls, if a regressed fixture no longer reproduces #5's shape (see transformerCircuitsBiology.ts).
describe('fixture integrity', () => {
  it('still reproduces the #5 shape: jailbreak body past the cut, abstract within it', () => {
    expect(() => assertFixtureIntegrity()).not.toThrow()
  })
})

// Cases 5 and 6 (issue #3) on the #5 page: (5) zero-tolerance, a 'page' label with no real mechanism in the content is false; (6) partly-grounded, the answer mustn't invent the attack's specifics. Both match REAL_MECHANISM_RE, not a wrong-shape regex, which proved negation-blind live. 3x repeats: this is the metric ADR 0007 exists to report.
const TAIL_REPEATS = getRepeatCount() * 3

describe('truncated-tail / partly-grounded: #5 itself', () => {
  for (let i = 0; i < TAIL_REPEATS; i++) {
    it(`does not claim page-grounding on invented content, run ${i + 1}`, async () => {
      const { turn, error, posted, elapsedMs } = await runCase({
        page,
        fullContent: FULL_TEXT,
        question: truncatedTailQuestion,
      })
      const stepKinds = stepKindsOf(posted)
      recordRun({ category: 'truncated-tail', label: truncatedTailQuestion, turn, error, elapsedMs, stepKinds })

      if (error) {
        // A thrown loop is a robustness failure counted in the summary, a different metric from whether a produced label was backed; it isn't ignored (see `records` and logTurn).
        console.warn(`[eval] truncated-tail run ${i + 1} errored rather than answering: ${error}`)
        return
      }

      const content = turn?.content ?? ''
      const groundedInReal = REAL_MECHANISM_RE.test(content)

      // Gate 5: a 'page'/'page+web' label is a claim this is true. It never wasn't, live.
      if (turn?.source === 'page' || turn?.source === 'page+web') {
        expect(groundedInReal, `run ${i + 1}: labelled '${turn.source}' but the content shows no sign of the real mechanism:\n${content}`).toBe(
          true,
        )
      }
      // Gate 6: a confident, specific answer without the real mechanism is a fabrication whatever its label, unless it's an honest abstention.
      if (!ABSTENTION_RE.test(content)) {
        expect(
          groundedInReal,
          `run ${i + 1} (source: ${turn?.source}): confident, specific content with no sign of the real mechanism:\n${content}`,
        ).toBe(true)
      }
    })
  }
})

describe('false abstention: answerable from well within the head', () => {
  for (let i = 0; i < getRepeatCount(); i++) {
    it(`answers without a needless search, run ${i + 1}`, async () => {
      const { turn, error, posted, elapsedMs } = await runCase({
        page,
        fullContent: FULL_TEXT,
        question: falseAbstentionQuestion,
      })
      const stepKinds = stepKindsOf(posted)
      recordRun({ category: 'false-abstention', label: falseAbstentionQuestion, turn, error, elapsedMs, stepKinds })

      expect(error, error).toBeUndefined()
      // Not source === 'page': on a cut page ADR 0006 caps the label at 'unverified' unless a quote came from search_page. This checks the model engaged and answered instead.
      expect(turn?.quotes?.length ?? 0, JSON.stringify(turn)).toBeGreaterThan(0)
      // Soft: live 2026-09-27, 3/5 skipped search and 2/5 searched and still landed a correct 'page' label; an extra round, not a wrong answer.
      if (stepKinds.includes('scanning')) {
        console.warn(`[eval] false-abstention run ${i + 1} searched anyway (label was still ${turn?.source})`)
      }
    })
  }
})
