import { describe, expect, it } from 'vitest'
import { bucketOf, checkChatBody, checkTavilyExtract, checkTavilySearch, isInstallId, routeFor } from './policy'

describe('routeFor', () => {
  it('allows only the calls the extension makes', () => {
    expect(routeFor('GET', '/nebius/models')).toEqual({ kind: 'nebius-models' })
    expect(routeFor('POST', '/nebius/chat/completions')).toEqual({ kind: 'nebius-chat' })
    expect(routeFor('POST', '/tavily/search')).toEqual({ kind: 'tavily-search' })
    expect(routeFor('POST', '/tavily/extract')).toEqual({ kind: 'tavily-extract' })
    expect(routeFor('POST', '/nebius/embeddings')).toBeUndefined()
    expect(routeFor('GET', '/tavily/search')).toBeUndefined()
    expect(routeFor('POST', '/nebius/models')).toBeUndefined()
  })

  it('counts chat and Tavily calls, not model listing', () => {
    expect(bucketOf({ kind: 'nebius-models' })).toBeUndefined()
    expect(bucketOf({ kind: 'nebius-chat' })).toBe('nebius')
    expect(bucketOf({ kind: 'tavily-extract' })).toBe('tavily')
  })
})

describe('isInstallId', () => {
  it('accepts a UUID and nothing else', () => {
    expect(isInstallId('3f1c9a52-7d6e-4b0a-9c1d-2e8f5a6b7c90')).toBe(true)
    expect(isInstallId('demo')).toBe(false)
    expect(isInstallId(undefined)).toBe(false)
  })
})

describe('checkChatBody', () => {
  const messages = [{ role: 'user', content: 'hi' }]
  it('accepts Nemotron', () => {
    expect(checkChatBody({ model: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B', messages }).ok).toBe(true)
  })
  it('refuses other models and malformed bodies', () => {
    expect(checkChatBody({ model: 'meta-llama/Llama-3.3-70B', messages }).ok).toBe(false)
    expect(checkChatBody({ model: 'nvidia/nemotron-x' }).ok).toBe(false)
    expect(checkChatBody('x').ok).toBe(false)
  })
})

describe('checkTavilySearch', () => {
  it('rebuilds the body from known fields and clamps results', () => {
    const r = checkTavilySearch({ query: 'pricing', include_domains: ['example.com'], max_results: 50, include_raw_content: true, api_key: 'x' })
    expect(r).toEqual({ ok: true, value: { query: 'pricing', search_depth: 'advanced', max_results: 5, include_domains: ['example.com'] } })
  })
  it('requires exactly one domain', () => {
    expect(checkTavilySearch({ query: 'q', include_domains: [] }).ok).toBe(false)
    expect(checkTavilySearch({ query: 'q', include_domains: ['a.com', 'b.com'] }).ok).toBe(false)
    expect(checkTavilySearch({ query: 'q' }).ok).toBe(false)
  })
})

describe('checkTavilyExtract', () => {
  it('takes one http(s) URL', () => {
    expect(checkTavilyExtract({ urls: ['https://example.com/a'] }).ok).toBe(true)
    expect(checkTavilyExtract({ urls: ['https://a.com', 'https://b.com'] }).ok).toBe(false)
    expect(checkTavilyExtract({ urls: ['file:///etc/passwd'] }).ok).toBe(false)
    expect(checkTavilyExtract({ urls: ['nope'] }).ok).toBe(false)
  })
})
