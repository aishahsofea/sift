import { describe, expect, it } from 'vitest'
import { truncate } from './truncate'

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
