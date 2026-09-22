import { describe, expect, it } from 'vitest'
import { parsePageGroundedResult } from './schema'

describe('parsePageGroundedResult', () => {
  it('parses a well-formed found-in-page response', () => {
    const raw = JSON.stringify({ found_in_page: true, answer: 'The launch date is March 3rd.' })
    expect(parsePageGroundedResult(raw)).toEqual({
      ok: true,
      result: { found_in_page: true, answer: 'The launch date is March 3rd.' },
    })
  })

  it('parses a well-formed not-found response', () => {
    const raw = JSON.stringify({ found_in_page: false, answer: "This isn't covered on the page." })
    expect(parsePageGroundedResult(raw)).toEqual({
      ok: true,
      result: { found_in_page: false, answer: "This isn't covered on the page." },
    })
  })

  it('rejects invalid JSON', () => {
    const result = parsePageGroundedResult('{not json')
    expect(result.ok).toBe(false)
  })

  it('rejects a JSON array', () => {
    const result = parsePageGroundedResult('[]')
    expect(result.ok).toBe(false)
  })

  it('rejects null', () => {
    const result = parsePageGroundedResult('null')
    expect(result.ok).toBe(false)
  })

  it('rejects a missing found_in_page field', () => {
    const result = parsePageGroundedResult(JSON.stringify({ answer: 'hi' }))
    expect(result.ok).toBe(false)
  })

  it('rejects a non-boolean found_in_page field', () => {
    const result = parsePageGroundedResult(JSON.stringify({ found_in_page: 'true', answer: 'hi' }))
    expect(result.ok).toBe(false)
  })

  it('rejects a missing answer field', () => {
    const result = parsePageGroundedResult(JSON.stringify({ found_in_page: true }))
    expect(result.ok).toBe(false)
  })

  it('rejects a non-string answer field', () => {
    const result = parsePageGroundedResult(JSON.stringify({ found_in_page: true, answer: 42 }))
    expect(result.ok).toBe(false)
  })
})
