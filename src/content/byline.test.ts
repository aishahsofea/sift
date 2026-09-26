import { describe, expect, it } from 'vitest'
import { normaliseByline, pickByline } from './byline'

// extractByline itself walks a real DOM, so it isn't covered here — these are the
// decisions it delegates: what counts as a byline, and which candidate wins.
describe('normaliseByline', () => {
  it('collapses runs of whitespace inside a line', () => {
    expect(normaliseByline('By   Jane    Doe')).toBe('By Jane Doe')
  })

  it('keeps line structure, so a labelled block stays readable', () => {
    const raw = 'AUTHORS\nJack Lindsey†\nPUBLISHED\nMarch 27, 2025'
    expect(normaliseByline(raw)).toBe('AUTHORS\nJack Lindsey†\nPUBLISHED\nMarch 27, 2025')
  })

  it('drops blank and whitespace-only lines', () => {
    expect(normaliseByline('AUTHORS\n\n   \nJane Doe\n')).toBe('AUTHORS\nJane Doe')
  })

  it('rejects a candidate longer than the limit rather than truncating it', () => {
    expect(normaliseByline('a'.repeat(50), 20)).toBeUndefined()
  })

  it('rejects empty and missing candidates', () => {
    expect(normaliseByline('')).toBeUndefined()
    expect(normaliseByline('   \n  ')).toBeUndefined()
    expect(normaliseByline(null)).toBeUndefined()
    expect(normaliseByline(undefined)).toBeUndefined()
  })

  it('rejects a single stray character', () => {
    expect(normaliseByline('•')).toBeUndefined()
  })
})

describe('pickByline', () => {
  it('takes the first candidate that normalises to something usable', () => {
    expect(pickByline([undefined, '', 'By Jane Doe', 'By Someone Else'])).toBe('By Jane Doe')
  })

  it('falls through a rejected candidate to a later one', () => {
    expect(pickByline(['a'.repeat(5_000), 'By Jane Doe'])).toBe('By Jane Doe')
  })

  it('returns undefined when no candidate is usable', () => {
    expect(pickByline([undefined, null, '', '  '])).toBeUndefined()
  })
})
