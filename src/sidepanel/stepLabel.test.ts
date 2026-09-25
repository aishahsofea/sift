import { describe, expect, it } from 'vitest'
import { describeStep } from './stepLabel'

describe('describeStep', () => {
  it('shows the domain and the query the model wrote', () => {
    expect(describeStep({ kind: 'searching', domain: 'example.com', query: 'Dana Reyes' })).toBe(
      'Searching example.com for “Dana Reyes”…',
    )
  })

  it('shortens a fetched URL to host and path', () => {
    expect(describeStep({ kind: 'reading', url: 'https://example.com/blog/post?utm=x' })).toBe(
      'Reading example.com/blog/post…',
    )
  })

  it('drops a bare trailing slash', () => {
    expect(describeStep({ kind: 'reading', url: 'https://example.com/' })).toBe('Reading example.com…')
  })

  it('falls back to the raw string when the URL will not parse', () => {
    expect(describeStep({ kind: 'reading', url: 'not a url' })).toBe('Reading not a url…')
  })
})
