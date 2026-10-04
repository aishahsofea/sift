export interface ExtractedPage {
  url: string
  title: string
  content: string
  /**
   * Author/affiliation/publication line, when the page has one. Separate from
   * `content` because on Distill-style layouts it lives outside the article
   * element Readability selects, so it is absent from `content` entirely (#6).
   */
  byline?: string
  extractionMethod: 'readability' | 'raw-text'
  /** `content` is only the start of the page: `truncate()` cut the rest from what the prompt holds. */
  truncated: boolean
  /** Chars `truncate()` cut from the end of `content`; 0 when `truncated` is false. */
  charsOmitted: number
  /**
   * The part cut from `content` was kept, so search_page can reach it and cite_page can
   * check quotes against it (#11). Set by the background once it has stored the whole
   * text, never by the content script; absent, or false, when the page was whole or the
   * text couldn't be kept.
   */
  searchable?: boolean
}

// What ties an answer to supplied text, derived from what happened this turn, never the model's account (ADR 0001, ADR 0005); label rules in deriveSource.
export type AnswerSource = 'page' | 'web' | 'page+web' | 'unverified'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  source?: AnswerSource
  /**
   * Passages the model quoted that were found in the page text this turn (#10).
   * Absent when none were. Kept so the panel can show the evidence behind an answer.
   */
  quotes?: string[]
  /**
   * This answer was written from a page cut short, without the model searching the page
   * for the part it lacked (#12). Carried per turn, not read off the current page:
   * history outlives navigation within a tab. Absent when the page was whole, and when
   * the model searched it (#11), even to no result, since then the cut is no longer what
   * limits the answer.
   */
  truncated?: boolean
  charsOmitted?: number
}

// What the loop is doing, emitted before each tool call; also keeps the port busy so the MV3 worker stays alive (ADR 0001).
export type AgentStep =
  | { kind: 'searching'; domain: string; query: string }
  | { kind: 'reading'; url: string }
  | { kind: 'scanning'; query: string }
  | { kind: 'citing' }

export type UnreadableReason =
  | 'restricted-url'
  | 'csp-blocked'
  | 'permission-denied'
  | 'no-content'
  | 'unknown-error'

// Text gated by the trace content toggle (off by default): `length` always recorded, `text` only when on (#18).
export interface TracedText {
  length: number
  text?: string
}

// Token usage off the wire; fields are optional so "not reported" is never mistaken for zero.
export interface TokenUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cachedTokens?: number
}

export type AgentTraceStatus = 'done' | 'error' | 'panel-closed'

export interface AgentTraceTiming {
  /** Absent when the round ended before any content or tool-call byte arrived. */
  firstByteMs?: number
  durationMs: number
}

export interface AgentTraceToolCall {
  name: string
  ok: boolean
  /** Always present, even with the content toggle off, e.g. "3 quotes, 2 verified, 1 rejected as too short". */
  summary: string
  args?: unknown
  result?: unknown
}

export interface AgentTraceRound {
  index: number
  model: string
  usage?: TokenUsage
  finishReason?: string
  timing: AgentTraceTiming
  /** Tools were stripped and a one-off nudge appended this round because MAX_TOOL_ROUNDS was reached (ADR 0003). */
  forced: boolean
  reasoning?: TracedText
  toolCalls: AgentTraceToolCall[]
  /** The unprompted answer mustQuoteFirst discarded this round, when it did (ADR 0005). */
  discardedAnswer?: TracedText
}

// Duplicates AnswerFacts in background/handlers/answerSource.ts because shared/ can't import background/; shows why deriveSource picked its label.
export interface AgentTraceSourceFacts {
  usedWeb: boolean
  quoteVerified: boolean
  pageTruncated: boolean
  quotedSearchResult: boolean
}

// The page's shape, never its text: that's already in chrome.storage.session, keyed by tabId.
export interface AgentTracePage {
  length: number
  truncated: boolean
  charsOmitted: number
  extractionMethod: ExtractedPage['extractionMethod']
  searchable: boolean
}

// One record per START_ASK run (#18), written as it goes; `page`, `toolsOffered` and the hashes are absent only for exits before a page loads.
export interface AgentTrace {
  id: string
  tabId: number
  startedAt: string
  endedAt: string
  status: AgentTraceStatus
  extensionVersion: string
  question: TracedText
  answer?: TracedText
  source?: AnswerSource
  sourceFacts?: AgentTraceSourceFacts
  page?: AgentTracePage
  toolsOffered?: string[]
  /** Hash of the system prompt with `page.content` spliced out: a diffing fingerprint, not a wording checksum. */
  promptHash?: string
  toolsHash?: string
  askedToQuote: boolean
  forcedNudgeSent: boolean
  forcedRetrySent: boolean
  rounds: AgentTraceRound[]
}
