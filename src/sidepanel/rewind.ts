import type { ChatTurn } from '../shared/types'

// Edit-and-resend (#46) and regenerate (#43) both replace a user turn and everything after
// it. `rewind` counts from the end so it matches the background's capped history.
export function replaceFrom(turns: ChatTurn[], question: string, editedIndex?: number): { rewind: number; next: ChatTurn[] } {
  const rewind = editedIndex === undefined ? 0 : Math.max(0, turns.length - editedIndex)
  const kept = rewind ? turns.slice(0, turns.length - rewind) : turns
  return { rewind, next: [...kept, { role: 'user', content: question }] }
}

// The question behind the answer being regenerated, or null if `index` isn't a user turn.
export function reloadTarget(turns: ChatTurn[], userIndex: number): { question: string; index: number } | null {
  const turn = turns[userIndex]
  return turn?.role === 'user' ? { question: turn.content, index: userIndex } : null
}
