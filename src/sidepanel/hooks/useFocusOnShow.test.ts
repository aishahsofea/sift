// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { canTakeFocus } from './useFocusOnShow'

describe('canTakeFocus', () => {
  const input = document.createElement('textarea')
  const button = document.createElement('button')
  document.body.append(input, button)

  it('takes focus when nothing is focused', () => {
    expect(canTakeFocus(null, input)).toBe(true)
    expect(canTakeFocus(document.body, input)).toBe(true)
    expect(canTakeFocus(input, input)).toBe(true)
  })

  it('leaves focus on another control', () => {
    expect(canTakeFocus(button, input)).toBe(false)
  })
})
