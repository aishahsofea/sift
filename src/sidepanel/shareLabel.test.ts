import { describe, expect, it } from 'vitest'
import { describeShare, shareOutcome } from './shareLabel'

const link = 'https://x/#u=a&d=b'

describe('shareOutcome', () => {
  it.each([
    [{ link, sharedPairs: 3, droppedPairs: 0 }, 'all'],
    [{ link, sharedPairs: 2, droppedPairs: 1 }, 'some'],
    [{ link: null, sharedPairs: 0, droppedPairs: 2 }, 'too-long'],
    [{ link: null, sharedPairs: 0, droppedPairs: 0 }, 'nothing'],
  ])('%j is %s', (result, outcome) => {
    expect(shareOutcome(result)).toBe(outcome)
  })
})

describe('describeShare', () => {
  it('names how many of the questions fit', () => {
    expect(describeShare({ link, sharedPairs: 2, droppedPairs: 3 })).toContain('last 2 of 5 questions')
  })

  it('uses the singular', () => {
    expect(describeShare({ link, sharedPairs: 1, droppedPairs: 0 })).toBe('Shares 1 question and their answers.')
  })
})
