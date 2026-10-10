import { MAX_SELECTION_CHARS, TRUNCATION_CHAR_LIMIT } from './constants'

export interface TruncateResult {
  content: string
  truncated: boolean
  charsOmitted: number
}

export function truncate(content: string, limit: number = TRUNCATION_CHAR_LIMIT): TruncateResult {
  if (content.length <= limit) {
    return { content, truncated: false, charsOmitted: 0 }
  }
  return { content: content.slice(0, limit), truncated: true, charsOmitted: content.length - limit }
}

// Idempotent: a selection already capped (limit chars plus the marker) caps to itself and stays flagged.
export function capSelection(selection: string): { text: string; truncated: boolean } {
  if (selection.length <= MAX_SELECTION_CHARS) return { text: selection, truncated: false }
  return { text: `${selection.slice(0, MAX_SELECTION_CHARS)}…`, truncated: true }
}
