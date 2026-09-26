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
  truncated: boolean
  /** Chars `truncate()` cut from the end of `content`; 0 when `truncated` is false. */
  charsOmitted: number
}

// What ties an answer to text we supplied. A label is a claim we have to be able
// to back, so it is derived from what happened this turn, never from the model's
// own account of it (ADR 0001, ADR 0005).
//   page       the model held the whole page and no web tool returned anything.
//              Still an inference from that absence: #10 turns it into a check.
//   web        a search or fetch returned something this turn.
//   page+web   page grounding verified and a web tool ran. Nothing sets this
//              until #10 adds the verification.
//   unverified nothing ties the answer to supplied text. Today that is the one case
//              we can detect: the page reached the model cut short and no web
//              tool returned anything.
export type AnswerSource = 'page' | 'web' | 'page+web' | 'unverified'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  source?: AnswerSource
  /**
   * The page this answer was given against was cut short (#12). Carried per turn,
   * not read off the current page: history outlives navigation within a tab.
   * Absent when the page was whole.
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

export type UnreadableReason =
  | 'restricted-url'
  | 'csp-blocked'
  | 'permission-denied'
  | 'no-content'
  | 'unknown-error'
