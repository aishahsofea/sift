import { describe, expect, it } from 'vitest'
import { deriveSource } from './answerSource'

describe('deriveSource', () => {
  it('labels a whole page with no web result as from the page', () => {
    expect(deriveSource({ usedWeb: false, pageTruncated: false })).toBe('page')
  })

  it('labels an answer backed by a web result as from the web', () => {
    expect(deriveSource({ usedWeb: true, pageTruncated: false })).toBe('web')
  })

  it('never labels a truncated page with no web result as from the page (#5)', () => {
    expect(deriveSource({ usedWeb: false, pageTruncated: true })).toBe('unverified')
  })

  it('still credits the web when the page was truncated but a search returned something', () => {
    expect(deriveSource({ usedWeb: true, pageTruncated: true })).toBe('web')
  })
})
