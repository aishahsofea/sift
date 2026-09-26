import { describe, expect, it } from 'vitest'
import { describeSource, explainSource } from './sourceLabel'

describe('describeSource', () => {
  it('says how many quotes were checked on a page answer, not that the answer was', () => {
    expect(describeSource('page', ['Thanks to the 1,200 beta testers'])).toBe('from the page · 1 quote checked')
  })

  it('pluralizes the quote count', () => {
    expect(describeSource('page', ['first passage here', 'second passage here'])).toBe(
      'from the page · 2 quotes checked',
    )
  })

  it('carries the count on a page+web answer too', () => {
    expect(describeSource('page+web', ['Thanks to the 1,200 beta testers'])).toBe(
      'from the page and the web · 1 quote checked',
    )
  })

  it('leaves the count off a turn stored with no quotes', () => {
    expect(describeSource('page')).toBe('from the page')
    expect(describeSource('page', [])).toBe('from the page')
  })

  it('labels a web answer as from the web', () => {
    expect(describeSource('web')).toBe('from the web')
  })

  it('says an unchecked answer was not checked, which is not the same as saying it is wrong', () => {
    expect(describeSource('unverified')).toBe('not checked against the page')
  })

  it('says a cut page is why, since the banner above already explains it', () => {
    expect(describeSource('unverified', [], { truncated: true })).toBe('not checked · page was cut short')
  })
})

describe('explainSource', () => {
  it('says an unchecked answer may still be right', () => {
    expect(explainSource('unverified')).toBe(
      'No quote from the page was found to check this answer against. It may still be right.',
    )
  })

  it('says a cut page could not be checked against the part that was not read', () => {
    expect(explainSource('unverified', { truncated: true })).toBe(
      "The page was cut short, so this answer can't be checked against the part that wasn't read. It may still be right.",
    )
  })

  it('says a verified quote is not a check on every claim', () => {
    expect(explainSource('page', { quotes: 2 })).toBe(
      "The model quoted the page and 2 quotes were found word for word. That doesn't mean every claim in the answer is on the page.",
    )
  })

  it('has nothing to add to a web answer', () => {
    expect(explainSource('web')).toBeUndefined()
  })
})
