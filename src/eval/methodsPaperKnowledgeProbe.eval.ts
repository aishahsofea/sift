import { afterAll, describe, expect, it, vi } from 'vitest'
import { getRepeatCount, printSummary, recordRun, runCase, stepKindsOf } from './harness'
import { page } from './fixtures/fictionalProductPage'
import { assertFixtureIntegrity, EDGE_THRESHOLD_RE, LOGIT_THRESHOLD_RE, METHODS_URL, NODE_THRESHOLD_RE } from './fixtures/transformerCircuitsMethods'

// Real runAgentLoop, same mocks as fetchPageEscalation.eval.ts. This probe never calls
// Tavily, but vi.mock hoists per-file, so they're redeclared anyway.
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

afterAll(() => {
  printSummary()
})

// Fails fast, no API call, if the fixture loses its real Appendix F thresholds past
// FETCHED_PAGE_CHAR_LIMIT — same check as fetchPageEscalation.eval.ts.
describe('fixture integrity', () => {
  it('still has the real Appendix F thresholds past FETCHED_PAGE_CHAR_LIMIT', () => {
    expect(() => assertFixtureIntegrity()).not.toThrow()
  })
})

// #30: fetchPageEscalation.eval.ts uses a real, public paper, so a correct answer with no
// fetch_page/search_page call could just mean the model already knew it. ADR 0007 fixed this
// with a fictional fixture; this probe asks about the paper by name/URL instead (not
// "companion paper", which needs page context this case deliberately withholds).
const probeQuestion = `What exact thresholds does the paper at ${METHODS_URL} use when pruning nodes and edges from an attribution graph, per its Appendix F?`

// Diagnostic, not a gate: no expected outcome to assert, just runs worth reading by hand
// (ADR 0007: "read the misses, not the count"). The fictional product page says nothing
// about attribution graphs, and omitting tavilyApiKey/searchResults/extractResult/fullContent
// means search_site/fetch_page/search_page are never even offered — the model has no path to
// the real page at all. cite_page stays offered, but ADR 0005's quote check rejects any quote
// not actually in the given page, so it can't smuggle in real content either.
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
