import { afterAll, describe, expect, it, vi } from 'vitest'
import { getRepeatCount, printSummary, recordRun, runCase, stepKindsOf } from './harness'
import { page } from './fixtures/fictionalProductPage'
import { assertFixtureIntegrity, EDGE_THRESHOLD_RE, LOGIT_THRESHOLD_RE, METHODS_URL, NODE_THRESHOLD_RE } from './fixtures/transformerCircuitsMethods'

// Real runAgentLoop, same three seams agentLoop.test.ts/fetchPageEscalation.eval.ts mock.
// This file never exercises Tavily (no case here has a tavilyApiKey), but hoisting is
// per-file (ADR 0007's decision section), so the mocks are redeclared anyway.
vi.mock('../background/history/sessionHistory', () => ({
  getExtractedPage: vi.fn(),
  getFullPageContent: vi.fn(),
  getHistory: vi.fn(),
  appendHistoryTurns: vi.fn(),
}))
vi.mock('../background/keys', () => ({ getApiKeys: vi.fn() }))
vi.mock('../background/tavily/client', () => ({ searchTavily: vi.fn(), extractTavily: vi.fn() }))

afterAll(() => {
  printSummary()
})

// Fails fast, with no API call, if a regressed fixture no longer has the real Appendix F
// thresholds past FETCHED_PAGE_CHAR_LIMIT — same check fetchPageEscalation.eval.ts runs,
// against the fixture this probe's question and grading both depend on.
describe('fixture integrity', () => {
  it('still has the real Appendix F thresholds past FETCHED_PAGE_CHAR_LIMIT', () => {
    expect(() => assertFixtureIntegrity()).not.toThrow()
  })
})

// #30: fetchPageEscalation.eval.ts's fixture is a real, public paper, so a run that lands on
// the right thresholds without ever calling fetch_page/search_page can't be told apart from
// "the model already knew this well-known paper" — ADR 0007 required a fictional fixture for
// exactly this reason, and this eval doesn't have one. Names the paper/URL directly rather
// than "companion paper" (that framing depends on page context this case withholds).
const probeQuestion = `What exact thresholds does the paper at ${METHODS_URL} use when pruning nodes and edges from an attribution graph, per its Appendix F?`

// Diagnostic, not a gate: there is no known-correct expected outcome to assert here, only a
// question worth answering by reading the runs (ADR 0007: "read the misses, not the count").
// The fictional product page carries nothing about attribution graphs, and no tavilyApiKey/
// searchResults/extractResult/fullContent means search_site and fetch_page/search_page are
// never even offered (agentLoop.ts: searchEnabled/pageSearchEnabled both require them) — the
// model has no path to transformer-circuits.pub at all, so any correct threshold in its
// answer can only come from what it already knew. cite_page stays on offer, but ADR 0005's
// quote verification rejects any "quote" not actually found in the given page's text, so it
// gives the model no way to smuggle in real methods.html content either.
describe('contamination probe: does the model know the thresholds with no retrieval path (#30)', () => {
  for (let i = 0; i < getRepeatCount(); i++) {
    it(`answers with no tool access, run ${i + 1}`, async () => {
      const { turn, error, posted, elapsedMs } = await runCase({ page, question: probeQuestion })
      const stepKinds = stepKindsOf(posted)
      recordRun({ category: 'methods-knowledge-probe', label: probeQuestion, turn, error, elapsedMs, stepKinds })

      const content = turn?.content ?? ''
      const landed = [NODE_THRESHOLD_RE, EDGE_THRESHOLD_RE, LOGIT_THRESHOLD_RE].filter((re) => re.test(content)).length
      console.log(`[eval] knowledge-probe run ${i + 1}: thresholds in answer ${landed}/3, answer ${JSON.stringify(content)}`)

      expect(error, error).toBeUndefined()
    })
  }
})
