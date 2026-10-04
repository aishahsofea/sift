import { MIN_QUOTE_CHARS } from '../../shared/constants'

// Enough of a rejected quote to recognise it, not a second copy of a long passage.
const ECHOED_QUOTE_CHARS = 80

// Collapses whitespace so quotes survive line wrapping; `\s` covers the U+00A0/U+202F Nemotron puts in dates.
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export interface QuoteCheck {
  /** Quotes found in the page text, whitespace-collapsed, each listed once. */
  verified: string[]
  /** One message per quote that wasn't found or was too short to count. */
  errors: string[]
}

// A quote counts only if it is a verbatim, case-sensitive substring of the collapsed page text (ADR 0005).
export function verifyQuotes(pageText: string, quotes: string[]): QuoteCheck {
  const haystack = collapseWhitespace(pageText)
  const verified: string[] = []
  const errors: string[] = []

  for (const quote of quotes) {
    const text = collapseWhitespace(quote)
    // Checked before the search: '' is a substring of every page.
    if (text.length < MIN_QUOTE_CHARS) {
      errors.push(`quote too short: ${JSON.stringify(clip(text))}`)
    } else if (!haystack.includes(text)) {
      errors.push(`quote not found in page text: ${JSON.stringify(clip(text))}`)
    } else if (!verified.includes(text)) {
      verified.push(text)
    }
  }

  return { verified, errors }
}

function clip(text: string): string {
  return text.length > ECHOED_QUOTE_CHARS ? `${text.slice(0, ECHOED_QUOTE_CHARS)}…` : text
}
