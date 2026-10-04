import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MAX_TOOL_ROUNDS } from '../shared/constants'
import type { AskPortMessage } from '../shared/messages'
import { getRepeatCount, printSummary, recordRun, runCase, stepKindsOf } from './harness'
import { FULL_TEXT, page } from './fixtures/transformerCircuitsBiology'
import {
  assertFixtureIntegrity,
  EDGE_THRESHOLD_RE,
  LOGIT_THRESHOLD_RE,
  METHODS_FULL_TEXT,
  METHODS_URL,
  NODE_THRESHOLD_RE,
  pruningQuestion,
  pruningSnippet,
  thresholdsQuestion,
} from './fixtures/transformerCircuitsMethods'

// Real runAgentLoop, same three seams agentLoop.test.ts/onPageAndWeb.eval.ts mock.
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

const FAKE_TAVILY_KEY = 'eval-fake-tavily-key'

// streamAgentTurn has no request timeout and Vitest can't abort the in-flight fetch, so a stalled stream cost ~15 minutes per case; scoped here so a stall fails fast and isn't read as a miss.
const REQUEST_TIMEOUT_MS = 90_000
const realFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (input, init) => realFetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
})

// Per-stage counts over non-stalled runs, as ADR 0009 reports them.
const chain = { runs: 0, searchedSite: 0, readPage: 0, searchedAfterReading: 0, thresholds3: 0, landedAfterScan: 0, searchedWithRoundLeft: 0, readGivenSearch: 0 }

// Floor on reading the page after a search; see the describe below.
const READ_FLOOR = 0.5
const MIN_OPPORTUNITIES = 6
// Of runs that searched the fetched page, how many reach all three thresholds (#27: 4 of 8 live, from 4 of 35). A floor far under that, for the search regressing; the expects stay off since the model often never searches.
const THRESHOLD_FLOOR = 0.25

afterAll(() => {
  globalThis.fetch = realFetch
  printSummary()
  console.log(
    `[eval] fetch-escalation chain over ${chain.runs} non-stalled runs: searched the site ${chain.searchedSite}, read the page ${chain.readPage}, ` +
      `search_page after reading ${chain.searchedAfterReading}, all three thresholds in the answer ${chain.thresholds3}; ` +
      `of the ${chain.searchedWithRoundLeft} that searched with a round left to read in, ${chain.readGivenSearch} read the page`,
  )
})

const isStall = (message: string | undefined): boolean => /abort|timed?\s?out/i.test(message ?? '')

const stepsOf = (posted: AskPortMessage[]) => posted.filter((m): m is Extract<AskPortMessage, { type: 'ASK_STEP' }> => m.type === 'ASK_STEP').map((m) => m.step)

// A stalled request is aborted at REQUEST_TIMEOUT_MS, and a run is up to four requests.
const RUN_TIMEOUT_MS = 4 * REQUEST_TIMEOUT_MS + 30_000

// The tab page as in the real incident: 242K chars, cut at 120K with the rest kept, so cite_page and search_page are offered from round one. search_site finds the companion paper with a thin snippet.
const ask = (question: string) =>
  runCase({
    page,
    fullContent: FULL_TEXT,
    question,
    tavilyApiKey: FAKE_TAVILY_KEY,
    searchResults: [{ title: 'Attribution Graphs: Methods', url: METHODS_URL, content: pruningSnippet }],
    extractResult: METHODS_FULL_TEXT,
  })

// Fails fast, with no API call, if a regressed fixture lacks the Appendix F thresholds past fetch_page's cut.
describe('fixture integrity', () => {
  it('still has the real Appendix F thresholds past FETCHED_PAGE_CHAR_LIMIT', () => {
    expect(() => assertFixtureIntegrity()).not.toThrow()
  })
})

// Issue #7's chain: thin snippet, fetch_page, then search_page past the fetched page's own cut (303,698 chars vs 20,000). That uses all MAX_TOOL_ROUNDS, so the search_page query decides the last stage. Reading after a search is a floor over the batch, not per run (30 of 31 vs 21 of 26 runs; ADR 0009), hence 3x repeats (ADR 0007). Reaching all three thresholds is reported, not gated: a mostly-red gate isn't a regression net.
describe('fetch_page escalates past a thin snippet, then past its own cut (#7)', () => {
  for (let i = 0; i < getRepeatCount() * 3; i++) {
    it(
      `reads the linked paper once a search returns a thin snippet, run ${i + 1}`,
      async () => {
        const { turn, error, posted, elapsedMs } = await ask(thresholdsQuestion)
        const stepKinds = stepKindsOf(posted)
        const steps = JSON.stringify(stepsOf(posted))
        recordRun({ category: 'fetch-escalation', label: thresholdsQuestion, turn, error, elapsedMs, stepKinds })

        if (isStall(error)) {
          // An endpoint stall says nothing about escalation; counted as an error, reported apart from misses (ADR 0009).
          console.warn(`[eval] fetch-escalation run ${i + 1} hit an endpoint stall, not counted: ${error}`)
          return
        }

        const content = turn?.content ?? ''
        const landed = [NODE_THRESHOLD_RE, EDGE_THRESHOLD_RE, LOGIT_THRESHOLD_RE].filter((re) => re.test(content)).length
        const firstSearch = stepKinds.indexOf('searching')
        const read = stepKinds.indexOf('reading')
        chain.runs++
        if (firstSearch !== -1) chain.searchedSite++
        if (read !== -1) chain.readPage++
        const scannedAfterReading = read !== -1 && stepKinds.indexOf('scanning', read) !== -1
        if (scannedAfterReading) chain.searchedAfterReading++
        if (landed === 3) chain.thresholds3++
        if (landed === 3 && scannedAfterReading) chain.landedAfterScan++
        console.log(`[eval] fetch-escalation run ${i + 1}: ${elapsedMs}ms, steps ${steps}, thresholds in answer ${landed}/3, label ${turn?.source}, answer ${JSON.stringify(content.slice(0, 400))}`)

        expect(error, error).toBeUndefined()
        // Only a search with a round left to read in counts; one in the last round is followed by the forced answer.
        if (firstSearch !== -1 && firstSearch < MAX_TOOL_ROUNDS - 1) {
          chain.searchedWithRoundLeft++
          if (read !== -1) chain.readGivenSearch++
        }
      },
      RUN_TIMEOUT_MS,
    )
  }

  // Done-when #1 of #7 (a thin snippet gives a Reading… step), as a floor over the batch; runs after the repeats.
  it('reads the page in most of the runs that searched with a round left to read in', () => {
    const { searchedWithRoundLeft: n, readGivenSearch: k } = chain
    if (n < MIN_OPPORTUNITIES) {
      console.warn(`[eval] fetch-escalation floor not checked: ${n} runs searched with a round left, it needs ${MIN_OPPORTUNITIES}`)
      return
    }
    expect(k / n, `read the page in ${k} of ${n} runs that searched with a round left`).toBeGreaterThanOrEqual(READ_FLOOR)
  })

  it('reaches all three thresholds in a share of the runs that searched the fetched page', () => {
    const { searchedAfterReading: n, landedAfterScan: k } = chain
    if (n < MIN_OPPORTUNITIES) {
      console.warn(`[eval] threshold floor not checked: ${n} runs searched after reading, it needs ${MIN_OPPORTUNITIES}`)
      return
    }
    expect(k / n, `all three thresholds in ${k} of ${n} runs that searched after reading`).toBeGreaterThanOrEqual(THRESHOLD_FLOOR)
  })
})

// Issue #7's own words, telemetry not a gate: the model judges the tab page to cover the question and never searches (see pruningQuestion), an open gap in its coverage judgement, not in escalation.
describe("issue #7's verbatim question (telemetry only)", () => {
  for (let i = 0; i < getRepeatCount(); i++) {
    it(`records whether the model looks past the tab page, run ${i + 1}`, async () => {
      const { turn, error, posted, elapsedMs } = await ask(pruningQuestion)
      const stepKinds = stepKindsOf(posted)
      recordRun({ category: 'fetch-escalation-verbatim', label: pruningQuestion, turn, error, elapsedMs, stepKinds })

      if (isStall(error)) {
        console.warn(`[eval] verbatim run ${i + 1} hit an endpoint stall: ${error}`)
        return
      }
      expect(error, error).toBeUndefined()
      console.log(`[eval] verbatim run ${i + 1}: steps ${JSON.stringify(stepsOf(posted))}, label ${turn?.source}, searched the site: ${stepKinds.includes('searching')}`)
    }, RUN_TIMEOUT_MS)
  }
})
