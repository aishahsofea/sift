import { vi } from 'vitest'
import { resolveNemotronModel } from '../background/nebius/modelDiscovery'
import { searchTavily, type TavilySearchResult } from '../background/tavily/client'
import { appendHistoryTurns, getExtractedPage, getFullPageContent, getHistory } from '../background/history/sessionHistory'
import { getApiKeys } from '../background/keys'
import { runAgentLoop } from '../background/handlers/agentLoop'
import type { AskPortMessage } from '../shared/messages'
import type { ChatTurn, ExtractedPage } from '../shared/types'

// Default repeat count for a case: one clean run proves little for a rate this eval
// exists to measure (ADR 0007). Overridable per invocation of `npm run test:eval`.
export function getRepeatCount(fallback = 5): number {
  const raw = process.env.EVAL_REPEATS
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function requireNebiusApiKey(): string {
  const key = process.env.NEBIUS_API_KEY
  if (!key) throw new Error('NEBIUS_API_KEY is not set. This eval drives the real Nebius endpoint (npm run test:eval reads .env).')
  return key
}

// Resolved and logged once per file (modelDiscovery.ts caches it module-wide anyway),
// so a run's console output states which model the numbers below it are about,
// rather than assuming it is still Nano (ADR 0002 asks to re-measure before any switch).
let modelLogged = false
async function ensureModelLogged(apiKey: string): Promise<void> {
  if (modelLogged) return
  modelLogged = true
  const model = await resolveNemotronModel(apiKey)
  console.log(`[eval] resolved model: ${model}`)
}

export interface RunCaseInput {
  page: ExtractedPage
  /** The whole text of the page, when it is longer than the prompt holds. */
  fullContent?: string
  question: string
  history?: ChatTurn[]
  tavilyApiKey?: string
  /** Canned search_site results. Omit for a case that must not be able to search. */
  searchResults?: TavilySearchResult[]
}

export interface RunCaseResult {
  turn: ChatTurn | undefined
  posted: AskPortMessage[]
  error: string | undefined
  elapsedMs: number
}

let tabCounter = 0

// Drives the real runAgentLoop for one question, with only the same three seams
// agentLoop.test.ts mocks faked: sessionHistory, keys, tavily/client. streamAgentTurn
// (Nebius) is never mocked here — it is the thing this eval measures.
export async function runCase(input: RunCaseInput): Promise<RunCaseResult> {
  const { page, fullContent, question, history = [], tavilyApiKey, searchResults } = input
  const nebiusApiKey = requireNebiusApiKey()
  await ensureModelLogged(nebiusApiKey)

  vi.mocked(getApiKeys).mockResolvedValue({ nebiusApiKey, tavilyApiKey })
  vi.mocked(getExtractedPage).mockResolvedValue(page)
  vi.mocked(getFullPageContent).mockResolvedValue(fullContent)
  vi.mocked(getHistory).mockResolvedValue(history)
  vi.mocked(appendHistoryTurns).mockResolvedValue([])
  if (searchResults) {
    vi.mocked(searchTavily).mockResolvedValue(searchResults)
  }

  const posted: AskPortMessage[] = []
  const port = {
    postMessage: (message: AskPortMessage) => posted.push(message),
    onDisconnect: { addListener: () => {} },
  } as unknown as chrome.runtime.Port

  const startedAt = Date.now()
  await runAgentLoop(port, ++tabCounter, question)
  const elapsedMs = Date.now() - startedAt

  const done = posted.find((m): m is Extract<AskPortMessage, { type: 'ASK_DONE' }> => m.type === 'ASK_DONE')
  const failed = posted.find((m): m is Extract<AskPortMessage, { type: 'ASK_ERROR' }> => m.type === 'ASK_ERROR')
  return { turn: done?.turn, posted, error: failed?.message, elapsedMs }
}

// The tool each ASK_STEP kind corresponds to. 'citing' fires both when cite_page
// actually ran and when the loop is about to nudge for an uncited answer, so it is
// a fine signal for "citing happened somewhere in this round" but not, on its own,
// proof cite_page was called — turn.quotes / turn.source settle that where it matters.
export function stepKindsOf(posted: AskPortMessage[]): string[] {
  return posted.filter((m): m is Extract<AskPortMessage, { type: 'ASK_STEP' }> => m.type === 'ASK_STEP').map((m) => m.step.kind)
}

export interface CaseRecord {
  category: string
  label: string
  turn: ChatTurn | undefined
  error: string | undefined
  elapsedMs: number
  stepKinds: string[]
}

const records: CaseRecord[] = []

export function recordRun(record: CaseRecord): void {
  records.push(record)
}

// Grouped by category: tool-call correctness is asserted by the test itself (so a
// regression fails the run, red); this is the soft telemetry the plan asks for
// alongside that — label distribution, quote-verification pass rate, rounds/latency —
// printed rather than asserted on, since a single run's mean proves nothing on its own.
export function printSummary(): void {
  const byCategory = new Map<string, CaseRecord[]>()
  for (const record of records) {
    const list = byCategory.get(record.category) ?? []
    list.push(record)
    byCategory.set(record.category, list)
  }

  console.log('\n[eval] summary')
  for (const [category, runs] of byCategory) {
    const errors = runs.filter((r) => r.error).length
    const sources = new Map<string, number>()
    for (const r of runs) {
      const key = r.turn?.source ?? (r.error ? 'error' : 'no-turn')
      sources.set(key, (sources.get(key) ?? 0) + 1)
    }
    const quoted = runs.filter((r) => (r.turn?.quotes?.length ?? 0) > 0).length
    const meanMs = Math.round(runs.reduce((sum, r) => sum + r.elapsedMs, 0) / runs.length)
    const sourceBreakdown = [...sources.entries()].map(([source, count]) => `${source}: ${count}`).join(', ')
    console.log(
      `  ${category} — ${runs.length} runs, ${errors} error(s), mean ${meanMs}ms. Labels: ${sourceBreakdown}. Quoted: ${quoted}/${runs.length}.`,
    )
  }
}
