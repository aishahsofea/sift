import type { ShareLink } from '../shared/shareSnapshot'

export type ShareOutcome = 'nothing' | 'too-long' | 'all' | 'some'

export function shareOutcome({ link, sharedPairs, droppedPairs }: ShareLink): ShareOutcome {
  if (sharedPairs + droppedPairs === 0) return 'nothing'
  if (!link) return 'too-long'
  return droppedPairs > 0 ? 'some' : 'all'
}

const questions = (n: number) => (n === 1 ? '1 question' : `${n} questions`)

export function describeShare(result: ShareLink): string {
  const { sharedPairs, droppedPairs } = result
  switch (shareOutcome(result)) {
    case 'nothing':
      return 'Nothing to share yet. Ask a question first.'
    case 'too-long':
      return "The latest answer is too long to fit in a link, so this thread can't be shared this way."
    case 'some':
      return `A link only has room for the last ${sharedPairs} of ${sharedPairs + droppedPairs} questions. The earlier ${questions(droppedPairs)} won't be included.`
    case 'all':
      return `Shares ${questions(sharedPairs)} and their answers.`
  }
}

export const SHARE_PRIVACY_NOTE =
  "The link holds the questions, answers, checked quotes and the page address, and no server stores it. Anyone who gets the link can read them. Quoted selections and the page's own text aren't included."
