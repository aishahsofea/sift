import type { AnswerSource } from '../../shared/types'

interface AnswerFacts {
  /** A search or fetch returned something this turn. */
  usedWeb: boolean
  /** A cite_page quote was found in the page text this turn (`verifyQuotes`). */
  quoteVerified: boolean
  /** The page reached the model cut short by `truncate()`. */
  pageTruncated: boolean
}

// Which label an answer gets, from what happened rather than from anything the
// model said (ADR 0001). Absence of a tool call is not evidence the answer came
// from the page (ADR 0005), so `page` needs a verified quote to stand on.
//
// One verified quote is a floor, not proof the whole answer is grounded (#5's answer
// was partly grounded). The label says the page was quoted, not that every claim in
// the answer is on it.
export function deriveSource({ usedWeb, quoteVerified, pageTruncated }: AnswerFacts): AnswerSource {
  if (usedWeb) return quoteVerified ? 'page+web' : 'web'
  // A cut page is checked against only its head, and a quote from the head can't
  // show the answer wasn't about the part that was cut — #5's failure exactly. So
  // truncation caps the label until #11 makes the whole page checkable.
  if (pageTruncated) return 'unverified'
  return quoteVerified ? 'page' : 'unverified'
}
