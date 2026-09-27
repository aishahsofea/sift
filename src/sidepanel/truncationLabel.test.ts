import { describe, expect, it } from 'vitest'
import { describeTruncatedAnswer, describeTruncatedPage } from './truncationLabel'

describe('describeTruncatedPage', () => {
  it('says how much of the page was not read, with a thousands separator, when the rest was not kept', () => {
    expect(describeTruncatedPage(126_323, false)).toBe(
      "The last 126,323 characters of this page weren't read, so answers about that part can't come from the page.",
    )
  })

  it('says the rest is searched, not that it is unread, when it was kept (#11)', () => {
    const text = describeTruncatedPage(126_323, true)
    expect(text).toBe('Sift reads the start up front and searches the remaining 126,323 characters when a question needs them.')
    expect(text).not.toContain("weren't read")
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
