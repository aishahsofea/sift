export interface ExtractedPage {
  url: string
  title: string
  content: string
  extractionMethod: 'readability' | 'raw-text'
  truncated: boolean
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  source?: 'page' | 'web'
}

export interface PageGroundedResult {
  found_in_page: boolean
  answer: string
}

export type UnreadableReason =
  | 'restricted-url'
  | 'csp-blocked'
  | 'permission-denied'
  | 'no-content'
  | 'unknown-error'
