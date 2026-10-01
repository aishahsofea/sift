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

// What ties an answer to text we supplied. A label is a claim we have to be able
// to back, so it is derived from what happened this turn, never from the model's
// own account of it (ADR 0001, ADR 0005).
//   page       the model quoted the page and at least one quote was found in the
//              page text, and no web tool returned anything. A floor, not proof
//              that every claim in the answer is on the page. On a page that
//              reached the model cut short, a quote also has to be one taken from
//              a passage search_page returned (#11).
//   web        a search or fetch returned something this turn.
//   page+web   the page conditions above hold and a web tool returned something.
//   unverified nothing ties the answer to supplied text: no quote was verified
//              (the tool was skipped, or nothing it was given is on the page), or
//              the page reached the model cut short and no quote came from a page
//              search, so a quote from the part it held can't show the answer wasn't
//              about the part it didn't.
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

// What the agent loop is doing right now. Emitted per tool call, before the call
// runs: drives the side panel and keeps the port busy so the MV3 service worker
// doesn't go idle mid-search (ADR 0001).
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

// One piece of run text gated by the trace content toggle (STORAGE_KEYS.traceContentEnabled,
// off by default): `length` is always recorded, `text` only when the toggle is on. Reused by
// every trace field whose "off" substitute is a bare count rather than a summary (#18).
export interface TracedText {
  length: number
  text?: string
}

// A round's token usage, straight off the wire (`stream_options.include_usage`). Fields are
// optional individually, not as a group: a round Nebius returns without usage is missing
// every field, never zeroed, so a reader can't mistake "not reported" for "reported as zero".
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

// Mirrors AnswerFacts in background/handlers/answerSource.ts — shared/ can't import from
// background/, so this is a deliberate duplicate, not drift. Kept alongside `source` so the
// trace shows why deriveSource picked that label, not only which one it picked.
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

// One record per START_ASK run (#18), written as the run goes so an errored or panel-closed
// run still leaves one. `page`, `toolsOffered`, `promptHash` and `toolsHash` are absent only
// for the two exits that happen before a page ever loads (no API key, no cached page) — every
// other field has a meaningful value even then.
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
