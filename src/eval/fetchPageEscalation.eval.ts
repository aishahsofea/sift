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
vi.mock('../background/keys', () => ({ getApiKeys: vi.fn() }))
vi.mock('../background/tavily/client', () => ({ searchTavily: vi.fn(), extractTavily: vi.fn() }))

const FAKE_TAVILY_KEY = 'eval-fake-tavily-key'

// streamAgentTurn has no request timeout of its own, so a stalled Nebius stream hangs
// until the socket dies: Vitest reports the test timed out at 120s but cannot abort the
// in-flight fetch, and this file's first live run spent ~15 minutes per stalled case.
// Scoped to this file so a stall fails fast and is told apart from a behavioural miss.
const REQUEST_TIMEOUT_MS = 90_000
const realFetch = globalThis.fetch
beforeAll(() => {
  globalThis.fetch = (input, init) => realFetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
})

// What each stage of the chain did, over the runs that were not endpoint stalls: the
// numbers ADR 0009 reports, printed here so a run states them without anyone re-reading
// the per-run lines.
const chain = { runs: 0, searchedSite: 0, readPage: 0, searchedAfterReading: 0, thresholds3: 0, searchedWithRoundLeft: 0, readGivenSearch: 0 }

// The floor on reading the page after a search, and how many runs must have searched with a
// round left before it is checked. See the comment on the describe below.
const READ_FLOOR = 0.5
const MIN_OPPORTUNITIES = 6

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

// The biology page is the tab page in the state the real incident was in: 242K characters,
// so cut at 120K with the rest kept, which puts cite_page and search_page on offer from the
// first round (fullContent, as truncatedTailGrounding.eval.ts does). The companion methods
// paper is what search_site finds, with a thin snippet (names the paper, no numbers).
const ask = (question: string) =>
  runCase({
    page,
    fullContent: FULL_TEXT,
    question,
    tavilyApiKey: FAKE_TAVILY_KEY,
    searchResults: [{ title: 'Attribution Graphs: Methods', url: METHODS_URL, content: pruningSnippet }],
    extractResult: METHODS_FULL_TEXT,
  })

// Fails fast, with no API call, if a regressed fixture no longer has the real Appendix F
// thresholds past where fetch_page's own cut falls.
describe('fixture integrity', () => {
  it('still has the real Appendix F thresholds past FETCHED_PAGE_CHAR_LIMIT', () => {
    expect(() => assertFixtureIntegrity()).not.toThrow()
  })
})

// Issue #7's chain, end to end: a question only the companion paper can answer, a thin
// search snippet, so the model has to fetch it; the fetched page is itself too long for one
// tool result (303,698 chars vs FETCHED_PAGE_CHAR_LIMIT's 20,000), so reaching the Appendix F
// thresholds takes search_page on top of that.
//
// The path is search_site, fetch_page, search_page, then the forced round: all three of
// MAX_TOOL_ROUNDS, so a search_page query that misses Appendix F has no round left to retry
// in. Which query the model writes therefore decides the last stage (verified locally against
// this fixture: "node pruning threshold" returns all three thresholds in its four passages,
// "graph pruning" returns none), and the model often writes the section's title.
//
// What is asserted and what is only reported follows what was measured (the rates are in
// ADR 0009). Reading the page after a search that left a round to read in is a rate, not an
// invariant: 30 of 31 runs with SEARCH_NOTE naming fetch_page, 21 of 26 without it, so one
// red run in a small batch would be noise. It is a floor over the whole batch instead, and
// only once enough runs searched with a round left, which is why this case gets 3x the
// repeats (ADR 0007's precedent for the case a metric depends on). The floor sits far below
// both rates: it is there for the catastrophe, the model no longer reading after a search,
// not for the difference the note makes.
// Reaching all three thresholds was a small minority of runs and most misses were honest "the
// appendix wasn't fetched" answers, so it is reported and not gated: a gate that is red most
// of the time is not a regression net, and ADR 0007 calibrates its own expectations to what
// is measured. Add the three threshold expects (NODE/EDGE/LOGIT) here once retrieval is
// good enough to hold them.
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
          // The endpoint stalled, which says nothing about whether the model escalates. It is
          // in the summary's error count, and reported apart from misses in ADR 0009.
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
        if (read !== -1 && stepKinds.indexOf('scanning', read) !== -1) chain.searchedAfterReading++
        if (landed === 3) chain.thresholds3++
        console.log(`[eval] fetch-escalation run ${i + 1}: ${elapsedMs}ms, steps ${steps}, thresholds in answer ${landed}/3, label ${turn?.source}, answer ${JSON.stringify(content.slice(0, 400))}`)

        expect(error, error).toBeUndefined()
        // Counted toward the floor below. Only a search with a round left to read in counts: one
        // in the last allowed round is followed by the forced answer, which runs no tools.
        if (firstSearch !== -1 && firstSearch < MAX_TOOL_ROUNDS - 1) {
          chain.searchedWithRoundLeft++
          if (read !== -1) chain.readGivenSearch++
        }
      },
      RUN_TIMEOUT_MS,
    )
  }

  // Done-when #1 of issue #7 (a thin snippet produces a Reading… step, not a snippet-based
  // answer), as a floor over the batch. Runs after the repeats above, in definition order.
  it('reads the page in most of the runs that searched with a round left to read in', () => {
    const { searchedWithRoundLeft: n, readGivenSearch: k } = chain
    if (n < MIN_OPPORTUNITIES) {
      console.warn(`[eval] fetch-escalation floor not checked: ${n} runs searched with a round left, it needs ${MIN_OPPORTUNITIES}`)
      return
    }
    expect(k / n, `read the page in ${k} of ${n} runs that searched with a round left`).toBeGreaterThanOrEqual(READ_FLOOR)
  })
})

// Issue #7's own words, as telemetry and not a gate. On this page the model does not get as
// far as searching: the tab page's own sentence about pruning reads to it as covering the
// question (see pruningQuestion in the fixture), so the escalation this record fixes never
// has a chance to fire. An open gap in the model's judgement of coverage, not in
// escalation, so it does not fail the run; the summary line is where it shows.
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
