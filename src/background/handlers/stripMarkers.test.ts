import { describe, expect, it } from 'vitest'
import { stripCitationMarkers } from './stripMarkers'

describe('stripCitationMarkers', () => {
  it('removes a marker and the space before it', () => {
    expect(stripCitationMarkers('It says so【cite_page】. Next.')).toBe('It says so. Next.')
    expect(stripCitationMarkers('It says so 【cite_page】 and more.')).toBe('It says so and more.')
  })

  it('removes markers with any label, several per answer', () => {
    expect(stripCitationMarkers('A【1†source】 B【cite_page】')).toBe('A B')
  })

  it('leaves text without markers untouched', () => {
    expect(stripCitationMarkers('Plain [1] answer (ok).\n\n- item')).toBe('Plain [1] answer (ok).\n\n- item')
  })
})
