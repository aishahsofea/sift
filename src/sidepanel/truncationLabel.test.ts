import { describe, expect, it } from 'vitest'
import { describeTruncatedAnswer, describeTruncatedPage } from './truncationLabel'

describe('describeTruncatedPage', () => {
  it('says how much of the page was not read, with a thousands separator', () => {
    expect(describeTruncatedPage(126_323)).toBe(
      "The last 126,323 characters of this page weren't read, so answers about that part can't come from the page.",
    )
  })
})

describe('describeTruncatedAnswer', () => {
  it('says how much of the page was not read', () => {
    expect(describeTruncatedAnswer(126_323)).toBe("Page was cut off: 126,323 characters weren't read.")
  })

  it('formats small counts without a separator', () => {
    expect(describeTruncatedAnswer(42)).toBe("Page was cut off: 42 characters weren't read.")
  })
})
