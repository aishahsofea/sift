import { describe, expect, it } from 'vitest'
import { deriveSource } from './answerSource'

const none = { usedWeb: false, quoteVerified: false, pageTruncated: false, quotedSearchResult: false }

describe('deriveSource', () => {
  describe('with the whole page in context', () => {
    it('labels an answer with a verified page quote as from the page', () => {
      expect(deriveSource({ ...none, quoteVerified: true })).toBe('page')
    })

    it('does not label a page answer as from the page when no quote was verified (#10)', () => {
      expect(deriveSource(none)).toBe('unverified')
    })

    it('labels an answer backed by a web result and no page quote as from the web', () => {
      expect(deriveSource({ ...none, usedWeb: true })).toBe('web')
    })

    it('labels an answer with both a web result and a verified page quote as page+web', () => {
      expect(deriveSource({ ...none, usedWeb: true, quoteVerified: true })).toBe('page+web')
    })
  })

  describe('when the page was truncated', () => {
    const truncated = { ...none, pageTruncated: true }

    it('never labels it from the page when no quote came from a page search, whatever was quoted (#5)', () => {
      expect(deriveSource(truncated)).toBe('unverified')
      expect(deriveSource({ ...truncated, quoteVerified: true })).toBe('unverified')
    })

    it('labels it from the page once a verified quote came from a passage the page search returned (#11)', () => {
      expect(deriveSource({ ...truncated, quoteVerified: true, quotedSearchResult: true })).toBe('page')
    })

    it('does not credit a page search with no quote behind the answer', () => {
      expect(deriveSource({ ...truncated, quotedSearchResult: true })).toBe('unverified')
    })

    it('still credits the web when a search returned something', () => {
      expect(deriveSource({ ...truncated, usedWeb: true })).toBe('web')
    })

    it('does not count a quote from the part it was given towards page+web either', () => {
      expect(deriveSource({ ...truncated, usedWeb: true, quoteVerified: true })).toBe('web')
    })

    it('labels it page+web when a quote came from the page search and the web returned something', () => {
      expect(deriveSource({ ...truncated, usedWeb: true, quoteVerified: true, quotedSearchResult: true })).toBe('page+web')
    })
  })

  it('ignores a page search result on a page that was whole, which is never offered one', () => {
    expect(deriveSource({ ...none, quotedSearchResult: true })).toBe('unverified')
    expect(deriveSource({ ...none, quotedSearchResult: true, quoteVerified: true })).toBe('page')
  })
})
