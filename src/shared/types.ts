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
