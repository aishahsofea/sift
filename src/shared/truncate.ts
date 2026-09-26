import { TRUNCATION_CHAR_LIMIT } from './constants'

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
