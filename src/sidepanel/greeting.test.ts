import { describe, expect, it } from 'vitest'
import { formatPageTitle, pickGreeting } from './greeting'

describe('formatPageTitle', () => {
  it('trims surrounding whitespace', () => {
    expect(formatPageTitle('  Hello World  ')).toBe('Hello World')
  })

  it('collapses runs of internal whitespace', () => {
    expect(formatPageTitle('Hello\n\n   World')).toBe('Hello World')
  })

  it('returns undefined for an empty or whitespace-only title', () => {
    expect(formatPageTitle('')).toBeUndefined()
    expect(formatPageTitle('   ')).toBeUndefined()
  })

  it('returns undefined when there is no title at all', () => {
    expect(formatPageTitle(undefined)).toBeUndefined()
  })

  it('truncates a long title and adds an ellipsis', () => {
    const long = 'a'.repeat(100)
    expect(formatPageTitle(long)).toBe(`${'a'.repeat(80)}…`)
  })

  it('leaves a title exactly at the limit untouched', () => {
    const exact = 'a'.repeat(80)
    expect(formatPageTitle(exact)).toBe(exact)
  })
})

describe('pickGreeting', () => {
  it('fills the formatted title into a titled variant', () => {
    expect(pickGreeting('Example Page', () => 0)).toBe('What do you want to know about “Example Page”?')
  })

  it('picks the variant the random source lands on', () => {
    expect(pickGreeting('Example Page', () => 0)).toBe('What do you want to know about “Example Page”?')
    expect(pickGreeting('Example Page', () => 0.999)).toBe(`Something in “Example Page” you'd like unpacked?`)
  })

  it('falls back to a title-less variant when there is no title', () => {
    expect(pickGreeting(undefined, () => 0)).toBe('What do you want to know about this page?')
    expect(pickGreeting('   ', () => 0)).toBe('What do you want to know about this page?')
  })

  it('never returns the excluded greeting, whatever the random source picks', () => {
    const previous = pickGreeting('Example Page', () => 0)
    for (let i = 0; i < 20; i++) {
      expect(pickGreeting('Example Page', () => i / 20, previous)).not.toBe(previous)
    }
  })

  it('excludes by exact text, so a stale exclude from a different pool is a no-op', () => {
    const previousTitled = pickGreeting('Example Page', () => 0)
    expect(pickGreeting(undefined, () => 0, previousTitled)).toBe('What do you want to know about this page?')
  })
})
