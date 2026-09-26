import { describe, expect, it } from 'vitest'
import { deriveSource } from './answerSource'

const none = { usedWeb: false, quoteVerified: false, pageTruncated: false }

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

    it('never labels it from the page with no web result, whatever was quoted (#5)', () => {
      expect(deriveSource(truncated)).toBe('unverified')
      expect(deriveSource({ ...truncated, quoteVerified: true })).toBe('unverified')
    })

    it('still credits the web when a search returned something', () => {
      expect(deriveSource({ ...truncated, usedWeb: true })).toBe('web')
    })
  })
})
