import { describe, expect, it } from 'vitest'
import { capSelection, truncate } from './truncate'

describe('truncate', () => {
  it('returns content unchanged when under the limit', () => {
    expect(truncate('short text', 100)).toEqual({ content: 'short text', truncated: false, charsOmitted: 0 })
  })

  it('returns content unchanged when exactly at the limit', () => {
    const content = 'a'.repeat(10)
    expect(truncate(content, 10)).toEqual({ content, truncated: false, charsOmitted: 0 })
  })

  it('truncates content over the limit and flags it', () => {
    const content = 'a'.repeat(20)
    const result = truncate(content, 10)
    expect(result.content).toBe('a'.repeat(10))
    expect(result.truncated).toBe(true)
  })

  it('reports how many chars were cut, so kept plus omitted is the original length', () => {
    const content = 'a'.repeat(246_323)
    const result = truncate(content)
    expect(result.charsOmitted).toBe(126_323)
    expect(result.content.length + result.charsOmitted).toBe(content.length)
  })

  it('uses the default limit when none is provided', () => {
    const content = 'a'.repeat(200_000)
    const result = truncate(content)
    expect(result.truncated).toBe(true)
    expect(result.content).toHaveLength(120_000)
  })
})

describe('capSelection', () => {
  it('returns a selection at the limit unchanged', () => {
    const selection = 'a'.repeat(2_000)
    expect(capSelection(selection)).toEqual({ text: selection, truncated: false })
  })

  it('cuts a longer selection and ends it with a marker', () => {
    expect(capSelection('a'.repeat(2_500))).toEqual({ text: `${'a'.repeat(2_000)}…`, truncated: true })
  })

  it('leaves an already capped selection as it is, still flagged', () => {
    const capped = capSelection('a'.repeat(2_500)).text
    expect(capSelection(capped)).toEqual({ text: capped, truncated: true })
  })
})
