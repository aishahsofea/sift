import { describe, expect, it } from 'vitest'
import type { ChatTurn } from '../shared/types'
import { reloadTarget, replaceFrom } from './rewind'

const turns: ChatTurn[] = [
  { role: 'user', content: 'q1' },
  { role: 'assistant', content: 'a1' },
  { role: 'user', content: 'q2' },
  { role: 'assistant', content: 'a2' },
]

describe('replaceFrom', () => {
  it('appends without rewinding for a new question', () => {
    const { rewind, next } = replaceFrom(turns, 'q3')
    expect(rewind).toBe(0)
    expect(next).toHaveLength(5)
  })

  it('regenerating the last answer drops it and re-asks the same question', () => {
    const target = reloadTarget(turns, 2)!
    const { rewind, next } = replaceFrom(turns, target.question, target.index)
    expect(rewind).toBe(2)
    expect(next.map((t) => t.content)).toEqual(['q1', 'a1', 'q2'])
  })
})

describe('reloadTarget', () => {
  it('only targets user turns', () => {
    expect(reloadTarget(turns, 1)).toBeNull()
    expect(reloadTarget(turns, 9)).toBeNull()
  })
})
