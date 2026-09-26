import { describe, expect, it } from 'vitest'
import { parseToolCall } from './schema'

const call = (overrides: Partial<{ id: string; name: string; argsText: string }> = {}) => ({
  id: 'call_1',
  name: 'search_site',
  argsText: JSON.stringify({ query: 'Dana Reyes' }),
  ...overrides,
})

describe('parseToolCall', () => {
  it('parses a search_site call', () => {
    expect(parseToolCall(call())).toEqual({
      ok: true,
      id: 'call_1',
      name: 'search_site',
      args: { query: 'Dana Reyes' },
    })
  })

  it('parses a fetch_page call', () => {
    const parsed = parseToolCall(
      call({ name: 'fetch_page', argsText: JSON.stringify({ url: 'https://example.com/a' }) }),
    )
    expect(parsed).toEqual({ ok: true, id: 'call_1', name: 'fetch_page', args: { url: 'https://example.com/a' } })
  })

  describe('cite_page', () => {
    const cite = (args: unknown) => call({ name: 'cite_page', argsText: JSON.stringify(args) })

    it('parses a list of quotes', () => {
      const parsed = parseToolCall(cite({ quotes: ['Thanks to the 1,200 beta testers', 'Published March 3, 2026.'] }))
      expect(parsed).toEqual({
        ok: true,
        id: 'call_1',
        name: 'cite_page',
        args: { quotes: ['Thanks to the 1,200 beta testers', 'Published March 3, 2026.'] },
      })
    })

    it('rejects quotes sent as a single string rather than a list', () => {
      const parsed = parseToolCall(cite({ quotes: 'Thanks to the 1,200 beta testers' }))
      expect(parsed.ok).toBe(false)
      expect(parsed.ok === false && parsed.error).toContain('"quotes" must be a non-empty list of strings')
    })

    it('rejects a missing quotes argument', () => {
      expect(parseToolCall(cite({})).ok).toBe(false)
    })

    it('rejects an empty list', () => {
      expect(parseToolCall(cite({ quotes: [] })).ok).toBe(false)
    })

    it('rejects a list holding something other than strings', () => {
      expect(parseToolCall(cite({ quotes: ['a real passage here', 42] })).ok).toBe(false)
    })

    it('rejects a list holding a blank string', () => {
      expect(parseToolCall(cite({ quotes: ['a real passage here', '  '] })).ok).toBe(false)
    })
  })

  it('ignores arguments the tool does not declare', () => {
    const parsed = parseToolCall(call({ argsText: JSON.stringify({ query: 'pricing', include_domains: ['evil.test'] }) }))
    expect(parsed).toEqual({ ok: true, id: 'call_1', name: 'search_site', args: { query: 'pricing' } })
  })

  it('rejects an unknown tool name', () => {
    const parsed = parseToolCall(call({ name: 'run_shell' }))
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.error).toContain('unknown tool')
  })

  it('rejects a missing id', () => {
    const parsed = parseToolCall(call({ id: '' }))
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.error).toContain('missing id')
  })

  it('rejects arguments that are not valid JSON', () => {
    const parsed = parseToolCall(call({ argsText: '{"query": ' }))
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.error).toContain("aren't a JSON object")
  })

  it('rejects a JSON array of arguments', () => {
    const parsed = parseToolCall(call({ argsText: '[]' }))
    expect(parsed.ok).toBe(false)
  })

  it('rejects a missing required argument', () => {
    const parsed = parseToolCall(call({ argsText: '{}' }))
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.error).toContain('missing "query" argument')
  })

  it('rejects a non-string required argument', () => {
    const parsed = parseToolCall(call({ argsText: JSON.stringify({ query: 42 }) }))
    expect(parsed.ok).toBe(false)
  })

  it('rejects a blank required argument', () => {
    const parsed = parseToolCall(call({ argsText: JSON.stringify({ query: '   ' }) }))
    expect(parsed.ok).toBe(false)
  })

  it('reports every problem in one error so the model can fix them together', () => {
    const parsed = parseToolCall(call({ id: '', argsText: '{}' }))
    expect(parsed.ok === false && parsed.error).toContain('missing id')
    expect(parsed.ok === false && parsed.error).toContain('missing "query" argument')
  })
})
