import { describe, expect, it } from 'vitest'
import { describeStep, describeStepDone } from './stepLabel'

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

  it('shows the words the model is looking for in the rest of the page', () => {
    expect(describeStep({ kind: 'scanning', query: 'jailbreak' })).toBe('Searching this page for “jailbreak”…')
  })

  it('says the quotes are being checked against the page', () => {
    expect(describeStep({ kind: 'citing' })).toBe('Checking quotes against the page…')
  })
})

describe('describeStepDone', () => {
  it('drops the ellipsis of the live label', () => {
    expect(describeStepDone({ kind: 'reading', url: 'https://example.com/pricing' })).toBe('Reading example.com/pricing')
    expect(describeStepDone({ kind: 'scanning', query: 'methods' })).toBe('Searching this page for “methods”')
  })

  it('says how many quotes the check found', () => {
    expect(describeStepDone({ kind: 'citing', found: 3, total: 3 })).toBe('Checking quotes against the page: 3 of 3 found')
    expect(describeStepDone({ kind: 'citing', found: 0, total: 2 })).toBe('Checking quotes against the page: 0 of 2 found')
  })

  it('leaves the count off a check that has no result', () => {
    expect(describeStepDone({ kind: 'citing' })).toBe('Checking quotes against the page')
  })

  it('keeps the live label free of the count', () => {
    expect(describeStep({ kind: 'citing', found: 3, total: 3 })).toBe('Checking quotes against the page…')
  })
})
