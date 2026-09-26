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
//   page       the model quoted the page and at least one quote was found in the
//              page text, and no web tool returned anything. A floor, not proof
//              that every claim in the answer is on the page.
//   web        a search or fetch returned something this turn.
//   page+web   a quote was verified and a web tool returned something.
//   unverified nothing ties the answer to supplied text: no quote was verified
//              (the tool was skipped, or nothing it was given is on the page), or
//              the page reached the model cut short and no web tool returned anything.
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
  | { kind: 'citing' }

export type UnreadableReason =
  | 'restricted-url'
  | 'csp-blocked'
  | 'permission-denied'
  | 'no-content'
  | 'unknown-error'
