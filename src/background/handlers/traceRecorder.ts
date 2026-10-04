import { MIN_QUOTE_CHARS } from '../../shared/constants'
import type {
  AgentTrace,
  AgentTracePage,
  AgentTraceRound,
  AgentTraceSourceFacts,
  AgentTraceStatus,
  AgentTraceToolCall,
  AnswerSource,
  TokenUsage,
  TracedText,
} from '../../shared/types'
import { CITE_PAGE, FETCH_PAGE, SEARCH_PAGE, SEARCH_SITE } from '../nebius/tools'
import { collapseWhitespace } from './verifyQuotes'

// Pure like verifyQuotes.ts, no chrome.*; agentLoop.ts is the only caller that persists the result (#18).

export interface CreateTraceRecorderInput {
  tabId: number
  question: string
  contentEnabled: boolean
}

// Scratch state for one run; the loop sets flags and hashes directly and they land unchanged on the trace.
export interface TraceRecorder {
  id: string
  tabId: number
  startedAt: string
  contentEnabled: boolean
  question: TracedText
  rounds: AgentTraceRound[]
  page?: AgentTracePage
  toolsOffered?: string[]
  promptHash?: string
  toolsHash?: string
  askedToQuote: boolean
  forcedNudgeSent: boolean
  forcedRetrySent: boolean
}

export function createTraceRecorder({ tabId, question, contentEnabled }: CreateTraceRecorderInput): TraceRecorder {
  return {
    id: crypto.randomUUID(),
    tabId,
    startedAt: new Date().toISOString(),
    contentEnabled,
    question: toTracedText(question, contentEnabled),
    rounds: [],
    askedToQuote: false,
    forcedNudgeSent: false,
    forcedRetrySent: false,
  }
}

export interface RoundInput {
  index: number
  model: string
  usage?: TokenUsage
  finishReason?: string
  timing: AgentTraceRound['timing']
  forced: boolean
  reasoning?: string
  discardedAnswer?: string
  toolCalls: AgentTraceToolCall[]
}

// Applies the content toggle at insertion, the one place redaction can go wrong.
export function recordRound(recorder: TraceRecorder, round: RoundInput): void {
  recorder.rounds.push({
    index: round.index,
    model: round.model,
    usage: round.usage,
    finishReason: round.finishReason,
    timing: round.timing,
    forced: round.forced,
    reasoning: round.reasoning === undefined ? undefined : toTracedText(round.reasoning, recorder.contentEnabled),
    toolCalls: round.toolCalls,
    discardedAnswer: round.discardedAnswer === undefined ? undefined : toTracedText(round.discardedAnswer, recorder.contentEnabled),
  })
}

// `summary` is always present, even with the toggle off: it is built from counts, never raw text.
export function summarizeToolCall(name: string, args: unknown, result: unknown, contentEnabled: boolean): AgentTraceToolCall {
  return {
    name,
    ok: toolCallSucceeded(result),
    summary: summarize(name, args, result),
    ...(contentEnabled ? { args, result } : {}),
  }
}

export interface FinalizeOutcome {
  status: AgentTraceStatus
  extensionVersion: string
  answer?: string
  source?: AnswerSource
  sourceFacts?: AgentTraceSourceFacts
}

// Pure: builds the record appendTrace persists from the recorder plus what only the loop's exit knows.
export function finalizeTrace(recorder: TraceRecorder, outcome: FinalizeOutcome): AgentTrace {
  return {
    id: recorder.id,
    tabId: recorder.tabId,
    startedAt: recorder.startedAt,
    endedAt: new Date().toISOString(),
    status: outcome.status,
    extensionVersion: outcome.extensionVersion,
    question: recorder.question,
    ...(outcome.answer === undefined ? {} : { answer: toTracedText(outcome.answer, recorder.contentEnabled) }),
    ...(outcome.source === undefined ? {} : { source: outcome.source }),
    ...(outcome.sourceFacts === undefined ? {} : { sourceFacts: outcome.sourceFacts }),
    ...(recorder.page === undefined ? {} : { page: recorder.page }),
    ...(recorder.toolsOffered === undefined ? {} : { toolsOffered: recorder.toolsOffered }),
    ...(recorder.promptHash === undefined ? {} : { promptHash: recorder.promptHash }),
    ...(recorder.toolsHash === undefined ? {} : { toolsHash: recorder.toolsHash }),
    askedToQuote: recorder.askedToQuote,
    forcedNudgeSent: recorder.forcedNudgeSent,
    forcedRetrySent: recorder.forcedRetrySent,
    rounds: recorder.rounds,
  }
}

// Diffing fingerprint that avoids storing the prompt; `pageContent` is spliced out of the hashed text.
export function fingerprintPrompt(systemPrompt: string, pageContent: string, tools: unknown): { promptHash: string; toolsHash: string } {
  const fixedPrompt = pageContent ? systemPrompt.split(pageContent).join('') : systemPrompt
  return {
    promptHash: fnv1a(fixedPrompt),
    toolsHash: fnv1a(JSON.stringify(tools ?? null)),
  }
}

function toTracedText(text: string, contentEnabled: boolean): TracedText {
  return { length: text.length, ...(contentEnabled ? { text } : {}) }
}

// Sync 32-bit FNV-1a: a diffing fingerprint, not a security control, so no async crypto.subtle.
function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Succeeded if no `error`, or cite_page's partial success (an error with a verified quote).
function toolCallSucceeded(result: unknown): boolean {
  if (!isRecord(result) || !('error' in result)) return true
  return Array.isArray(result.verified) && result.verified.length > 0
}

function summarize(name: string, args: unknown, result: unknown): string {
  const error = isRecord(result) && typeof result.error === 'string' ? result.error : undefined

  if (name === CITE_PAGE) return summarizeCitePage(args, result)
  if (name === SEARCH_SITE) return summarizeCount(result, 'results', error)
  if (name === SEARCH_PAGE) return summarizeCount(result, 'passages', error)
  if (name === FETCH_PAGE) return summarizeFetch(result, error)
  return error ? `error: ${error}` : `${name} called`
}

// Reclassifies rejected quotes with verifyQuotes' own threshold, since its error string is clipped (#18).
function summarizeCitePage(args: unknown, result: unknown): string {
  const quotes = isRecord(args) && Array.isArray(args.quotes) ? (args.quotes as string[]) : undefined
  const verified = isRecord(result) && Array.isArray(result.verified) ? (result.verified as string[]) : undefined
  const error = isRecord(result) && typeof result.error === 'string' ? result.error : undefined

  if (!quotes || !verified) return error ? `error: ${error}` : 'cite_page called'

  const verifiedSet = new Set(verified)
  let tooShort = 0
  let notFound = 0
  for (const quote of quotes) {
    const text = collapseWhitespace(quote)
    if (verifiedSet.has(text)) continue
    if (text.length < MIN_QUOTE_CHARS) tooShort++
    else notFound++
  }

  const parts = [`${quotes.length} quote${quotes.length === 1 ? '' : 's'}`, `${verified.length} verified`]
  const rejected = tooShort + notFound
  if (rejected && tooShort && notFound) parts.push(`${rejected} rejected (${tooShort} too short, ${notFound} not found)`)
  else if (tooShort) parts.push(`${rejected} rejected as too short`)
  else if (notFound) parts.push(`${rejected} rejected as not found`)
  return parts.join(', ')
}

function summarizeCount(result: unknown, noun: 'results' | 'passages', error: string | undefined): string {
  if (error) return `error: ${error}`
  const list = isRecord(result) ? result[noun] : undefined
  const count = Array.isArray(list) ? list.length : 0
  return count === 0 ? `no ${noun} found` : `${count} ${noun} found`
}

function summarizeFetch(result: unknown, error: string | undefined): string {
  if (error) return `error: ${error}`
  const content = isRecord(result) && typeof result.content === 'string' ? result.content : ''
  return `fetched ${content.length} chars`
}
