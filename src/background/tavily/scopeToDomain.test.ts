import { describe, expect, it } from 'vitest'
import { scopeToDomain } from './scopeToDomain'

describe('scopeToDomain', () => {
  it('extracts the hostname from a simple URL', () => {
    expect(scopeToDomain('https://example.com/article/123')).toBe('example.com')
  })

  it('strips query strings and fragments', () => {
    expect(scopeToDomain('https://example.com/search?q=test#section')).toBe('example.com')
  })

  it('preserves subdomains', () => {
    expect(scopeToDomain('https://docs.example.com/guide')).toBe('docs.example.com')
  })

  it('excludes the port from the scoped domain', () => {
    expect(scopeToDomain('https://example.com:8443/page')).toBe('example.com')
  })
})
