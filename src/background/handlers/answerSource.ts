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

// Which label an answer gets, from what happened rather than from anything the
// model said (ADR 0001). Absence of a tool call is not evidence the answer came
// from the page (ADR 0005), so `page` needs a verified quote to stand on.
//
// One verified quote is a floor, not proof the whole answer is grounded (#5's answer
// was partly grounded). The label says the page was quoted, not that every claim in
// the answer is on it.
export function deriveSource({ usedWeb, quoteVerified, pageTruncated, quotedSearchResult }: AnswerFacts): AnswerSource {
  // On a page the prompt held only the start of, a quote from that start can't show
  // the answer wasn't about the part that was cut — #5's failure exactly. What can is
  // the model quoting a passage its search of the whole page returned: it went and
  // looked, and used what it found. Searching and then quoting the head anyway does not
  // count (ADR 0006). Before #11 nothing could, and truncation capped the label outright.
  const pageQuoted = quoteVerified && (!pageTruncated || quotedSearchResult)
  if (usedWeb) return pageQuoted ? 'page+web' : 'web'
  return pageQuoted ? 'page' : 'unverified'
}
