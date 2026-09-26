import { MIN_QUOTE_CHARS } from '../../shared/constants'

// How much of a rejected quote goes back to the model in the error: enough to
// recognize which one it was, not a second copy of a long passage.
const ECHOED_QUOTE_CHARS = 80

// Whitespace runs become one space and the ends are trimmed, so a quote survives
// the page's line wrapping and the model's own respacing. `\s` covers the no-break
// and narrow no-break spaces (U+00A0, U+202F) Nemotron puts in dates like "March 3".
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export interface QuoteCheck {
  /** Quotes found in the page text, whitespace-collapsed, each listed once. */
  verified: string[]
  /** One message per quote that wasn't found or was too short to count. */
  errors: string[]
}

// The deterministic half of quote-then-answer (ADR 0005): a quote counts only if
// it is a substring of the page text once whitespace is collapsed on both sides.
// Case-sensitive and verbatim on purpose — an ellipsis joining two fragments, or a
// paraphrase in quotation marks, isn't on the page and doesn't verify.
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
