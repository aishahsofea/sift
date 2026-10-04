import type { AnswerSource } from '../../shared/types'

interface AnswerFacts {
  /** A search or fetch returned something this turn. */
  usedWeb: boolean
  /** A cite_page quote was found in the page text this turn (`verifyQuotes`). */
  quoteVerified: boolean
  /** The page reached the model cut short by `truncate()`. */
  pageTruncated: boolean
  /** A verified quote is inside a passage search_page returned this turn: the model quoted what it found in the page (#11). */
  quotedSearchResult: boolean
}

// Label from what happened, not what the model said (ADR 0001); `page` needs a verified quote (ADR 0005), a floor not proof every claim is on the page.
export function deriveSource({ usedWeb, quoteVerified, pageTruncated, quotedSearchResult }: AnswerFacts): AnswerSource {
  // On a cut page only a quote from a search_page passage counts: quoting the head can't show the answer wasn't about the cut part (#5, ADR 0006).
  const pageQuoted = quoteVerified && (!pageTruncated || quotedSearchResult)
  if (usedWeb) return pageQuoted ? 'page+web' : 'web'
  return pageQuoted ? 'page' : 'unverified'
}
