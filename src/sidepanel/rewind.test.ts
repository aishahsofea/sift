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

describe('a quoted selection', () => {
  const quoted: ChatTurn[] = [
    { role: 'user', content: 'q1', selection: 'a passage' },
    { role: 'assistant', content: 'a1' },
  ]

  it('goes on the new user turn', () => {
    const { next } = replaceFrom(turns, 'q3', undefined, 'a passage')
    expect(next.at(-1)).toEqual({ role: 'user', content: 'q3', selection: 'a passage' })
  })

  it('leaves the new user turn without a selection field when none is given', () => {
    expect(replaceFrom(turns, 'q3').next.at(-1)).toEqual({ role: 'user', content: 'q3' })
  })

  it('is carried by regenerate, so the re-asked question keeps its quote', () => {
    const target = reloadTarget(quoted, 0)!
    expect(target.selection).toBe('a passage')
    const { next } = replaceFrom(quoted, target.question, target.index, target.selection)
    expect(next).toEqual([{ role: 'user', content: 'q1', selection: 'a passage' }])
  })

  it('is kept by an edit that brings none', () => {
    const { next } = replaceFrom(quoted, 'q1 edited', 0)
    expect(next).toEqual([{ role: 'user', content: 'q1 edited', selection: 'a passage' }])
  })

  it('is replaced by an edit that brings its own', () => {
    const { next } = replaceFrom(quoted, 'q1 edited', 0, 'another passage')
    expect(next).toEqual([{ role: 'user', content: 'q1 edited', selection: 'another passage' }])
  })
})

describe('reloadTarget', () => {
  it('only targets user turns', () => {
    expect(reloadTarget(turns, 1)).toBeNull()
    expect(reloadTarget(turns, 9)).toBeNull()
  })
})
