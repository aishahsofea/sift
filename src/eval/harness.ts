import { vi } from 'vitest'
import { resolveNemotronModel } from '../background/nebius/modelDiscovery'
import { extractTavily, searchTavily, type TavilySearchResult } from '../background/tavily/client'
import { appendHistoryTurns, getExtractedPage, getFullPageContent, getHistory } from '../background/history/sessionHistory'
import { getApiKeys } from '../background/keys'
import { runAgentLoop } from '../background/handlers/agentLoop'
import type { AskPortMessage } from '../shared/messages'
import type { ChatTurn, ExtractedPage } from '../shared/types'

// One run proves little for a rate this eval measures (ADR 0007); overridable per `npm run test:eval`.
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

// Logged once per file so output states which model the numbers are about (ADR 0002).
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
  /** Canned fetch_page (extractTavily) result. Omit for a case that must not fetch. */
  extractResult?: string
}

export interface RunCaseResult {
  turn: ChatTurn | undefined
  posted: AskPortMessage[]
  error: string | undefined
  elapsedMs: number
}

let tabCounter = 0

// Drives the real runAgentLoop with sessionHistory, keys and tavily/client faked; streamAgentTurn is live.
export async function runCase(input: RunCaseInput): Promise<RunCaseResult> {
  const { page, fullContent, question, history = [], tavilyApiKey, searchResults, extractResult } = input
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
  if (extractResult !== undefined) {
    vi.mocked(extractTavily).mockResolvedValue(extractResult)
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

// 'citing' fires when cite_page ran or the loop nudged for an uncited answer; turn.quotes settles it.
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

// Soft telemetry (labels, quote pass rate, latency), printed not asserted since one run proves nothing.
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
