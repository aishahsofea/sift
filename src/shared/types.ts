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
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  source?: 'page' | 'web'
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
