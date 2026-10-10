import type { ChatTurn } from '../shared/types'

// Edit-and-resend (#46) and regenerate (#43) replace a user turn and all after it; counted from the end.
export function replaceFrom(
  turns: ChatTurn[],
  question: string,
  editedIndex?: number,
  quoted?: string,
): { rewind: number; next: ChatTurn[] } {
  // An edit with no selection of its own keeps the one on the turn it replaces.
  const selection = quoted ?? (editedIndex === undefined ? undefined : turns[editedIndex]?.selection)
  const rewind = editedIndex === undefined ? 0 : Math.max(0, turns.length - editedIndex)
  const kept = rewind ? turns.slice(0, turns.length - rewind) : turns
  return { rewind, next: [...kept, { role: 'user', content: question, ...(selection ? { selection } : {}) }] }
}

// The question (and its quoted selection) behind the answer being regenerated, or null if `index` isn't a user turn.
export function reloadTarget(
  turns: ChatTurn[],
  userIndex: number,
): { question: string; selection?: string; index: number } | null {
  const turn = turns[userIndex]
  return turn?.role === 'user' ? { question: turn.content, selection: turn.selection, index: userIndex } : null
}
