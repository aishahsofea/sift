import { afterAll, describe, expect, it, vi } from 'vitest'
import { getRepeatCount, printSummary, recordRun, runCase, stepKindsOf } from './harness'
import { page } from './fixtures/fictionalProductPage'
import { assertFixtureIntegrity, EDGE_THRESHOLD_RE, LOGIT_THRESHOLD_RE, METHODS_URL, NODE_THRESHOLD_RE } from './fixtures/transformerCircuitsMethods'

// Real runAgentLoop, same mocks as fetchPageEscalation.eval.ts, redeclared since vi.mock hoists per file.
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

// Fails fast, with no API call, if the fixture loses its real Appendix F thresholds past FETCHED_PAGE_CHAR_LIMIT.
describe('fixture integrity', () => {
  it('still has the real Appendix F thresholds past FETCHED_PAGE_CHAR_LIMIT', () => {
    expect(() => assertFixtureIntegrity()).not.toThrow()
  })
})

// #30: with a real public paper a correct answer could be prior knowledge, so ask about it by name/URL, not "companion paper" (which needs withheld page context). See ADR 0007.
const probeQuestion = `What exact thresholds does the paper at ${METHODS_URL} use when pruning nodes and edges from an attribution graph, per its Appendix F?`

// Diagnostic, not a gate (ADR 0007: "read the misses, not the count"): no retrieval tool is offered, and cite_page rejects quotes not in the given page.
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
