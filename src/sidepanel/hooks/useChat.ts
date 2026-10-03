import { useEffect, useState } from 'react'
import type { BackgroundRequest, BackgroundResponse } from '../../shared/messages'
import type { ChatTurn } from '../../shared/types'
import { describeStep } from '../stepLabel'
import { reloadTarget, replaceFrom } from '../rewind'
import { useAskStream } from './useAskStream'

export function useChat(tabId: number | null) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stream = useAskStream()

  useEffect(() => {
    if (tabId === null) return
    let cancelled = false

    async function loadHistory(id: number) {
      const request: BackgroundRequest = { type: 'GET_HISTORY', tabId: id }
      const response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse
      if (!cancelled && response.type === 'HISTORY_RESULT') {
        setTurns(response.turns)
        setHistoryLoaded(true)
      }
    }

    loadHistory(tabId)
    return () => {
      cancelled = true
    }
  }, [tabId])

  // `editedIndex` is the user turn being replaced: it and every turn after it go, in the
  // panel and (via `rewind`) in the stored history, so the two stay the same.
  async function ask(question: string, editedIndex?: number) {
    const trimmed = question.trim()
    if (tabId === null || stream.active || !trimmed) return

    const { rewind, next } = replaceFrom(turns, trimmed, editedIndex)
    const rewound = next.slice(0, -1)
    setError(null)
    setTurns(next)

    // One call for every question: the model decides inside the loop whether to
    // search, so there's no page-first pass to branch on out here.
    const result = await stream.start(tabId, trimmed, rewind || undefined)
    if (!result.ok) {
      // A stopped answer isn't stored, so the question goes too: the panel stays
      // the same as history, which is what a later rewind counts against.
      if ('stopped' in result) setTurns(rewound)
      else setError(result.message)
      return
    }
    setTurns((prev) => [...prev, result.turn])
  }

  // Regenerate: the same path as an edit that changes nothing.
  async function reload(userIndex: number) {
    const target = reloadTarget(turns, userIndex)
    if (target) await ask(target.question, target.index)
  }

  async function clear() {
    if (tabId === null) return
    const request: BackgroundRequest = { type: 'CLEAR_HISTORY', tabId }
    await chrome.runtime.sendMessage(request)
    setTurns([])
    setError(null)
  }

  // Nothing has streamed in yet: the panel shows a pending indicator instead of a fake
  // bubble. Once a chunk arrives it joins turns like any other answer — the in-flight
  // bubble carries no source label, since which one is right is only known once the
  // loop reports the tool calls it actually made.
  const hasStreamedText = stream.active && stream.text.length > 0
  const displayTurns: ChatTurn[] = hasStreamedText ? [...turns, { role: 'assistant', content: stream.text }] : turns
  const pendingStepLabel = stream.active && !hasStreamedText ? pendingLabel(stream.step) : null

  return { turns: displayTurns, asking: stream.active, pendingStepLabel, error, ask, reload, stop: stream.stop, clear, historyLoaded }
}

function pendingLabel(step: Parameters<typeof describeStep>[0] | null): string {
  return step ? describeStep(step) : 'Thinking…'
}
