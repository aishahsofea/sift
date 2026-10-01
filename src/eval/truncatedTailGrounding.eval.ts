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

// Real runAgentLoop, same three seams faked as agentLoop.test.ts and onPageAndWeb.eval.ts.
// tavilyApiKey is always undefined in this file (no case here ever has a Tavily key), so
// searchTavily/extractTavily are stubbed to throw: that turns "this file never calls
// real Tavily" from an assumption into something a wrong call would fail loudly on.
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

// Fails fast, with no API calls, if a regressed fixture no longer reproduces #5's shape
// (see transformerCircuitsBiology.ts's capture note on why this can't just be curled).
describe('fixture integrity', () => {
  it('still reproduces the #5 shape: jailbreak body past the cut, abstract within it', () => {
    expect(() => assertFixtureIntegrity()).not.toThrow()
  })
})

// Cases 5 and 6 (issue #3): the #5 question, on the #5 page, run together because they
// are two gates on the same output, not two different runs.
//
//   5. truncated-tail (zero-tolerance): a 'page'/'page+web' label is a claim the answer
//      came from real page text. If the content doesn't contain the real mechanism, the
//      claim was false regardless of how it got the label — this must never happen.
//   6. partly-grounded: the historical failure was half-right (the "keeps going" framing
//      is in the in-context abstract) and half-invented (the attack's specifics are past
//      the cut). This checks the content for the known-wrong shape of that invention,
//      regardless of what label the answer got — a low label doesn't excuse bad content,
//      it just isn't this eval's problem to catch (mislabeling is gate 5's job).
//
// Both gates check for REAL_MECHANISM_RE rather than against a WRONG_MECHANISM_RE: a first
// version did the latter and, live, matched a real, correctly-negated statement of the
// paper's actual finding ("it does **not** recognize... bomb... keeps generating") because
// the pattern never checked for the "not" in between, and separately false-triggered on an
// idiom ("completing the chain of thought it has started") that wasn't claiming the attack
// manipulates chain-of-thought at all. Matching the specific, verified real shape held up
// across every live run; enumerating every wrong one didn't (see transformerCircuitsBiology.ts).
//
// A higher repeat count than the other categories: this is the metric the whole plan
// exists to report a number for (ADR 0007), so a single clean run proves the least here.
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
        // A thrown loop (round cap exhausted, unparsed markup, ...) is a robustness
        // failure, tracked in the summary above — a different metric from whether a
        // *label* the loop actually produced was backed by real content, which is what
        // this gate exists to catch. It is not silently ignored: it is in `records` and
        // in the console line agentLoop.ts's own logTurn prints for every real attempt.
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
      // Gate 6: a confident, specific answer with no sign of the real mechanism is a
      // fabrication regardless of what label it got — unless it's an honest abstention,
      // which correctly has nothing to match either.
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
      // Not source === 'page': on a cut page, ADR 0006 rule 6 caps the label at
      // 'unverified' unless a verified quote came from a search_page passage, even
      // when the quote is genuinely from the head (a quote from the part the model
      // was given can't by itself show the answer isn't about the part it wasn't —
      // deriveSource can't tell "the head already answers" from "it partly does").
      // What false abstention actually means — did the model engage and answer,
      // rather than needlessly searching or refusing — is what this checks instead.
      expect(turn?.quotes?.length ?? 0, JSON.stringify(turn)).toBeGreaterThan(0)
      // Soft, not hard: confirmed live (npm run test:eval, 2026-09-27) this is a mixed
      // 3/5 no-search vs 2/5 searched-anyway split, and the 2 that searched still landed
      // on a correct, well-grounded 'page' label — an extra round, not a wrong answer.
      if (stepKinds.includes('scanning')) {
        console.warn(`[eval] false-abstention run ${i + 1} searched anyway (label was still ${turn?.source})`)
      }
    })
  }
})
