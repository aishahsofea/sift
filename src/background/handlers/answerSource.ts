import type { AnswerSource } from '../../shared/types'

interface AnswerFacts {
  /** A search or fetch returned something this turn. */
  usedWeb: boolean
  /** The page reached the model cut short by `truncate()`. */
  pageTruncated: boolean
}

// Which label an answer gets, from what happened rather than from anything the
// model said (ADR 0001). Absence of a tool call is not evidence the answer came
// from the page (ADR 0005): on a truncated page the model held a fragment, so an
// answer with no web result behind it can't be traced to the page.
//
// `page+web` is not returned here. It needs a verified page quote next to a web
// result, and nothing verifies quotes until #10.
export function deriveSource({ usedWeb, pageTruncated }: AnswerFacts): AnswerSource {
  if (usedWeb) return 'web'
  if (pageTruncated) return 'unverified'
  return 'page'
}
