import { useEffect, useState } from 'react'
import type { BackgroundRequest, BackgroundResponse } from '../../shared/messages'
import type { ChatTurn } from '../../shared/types'
import { describeStep } from '../stepLabel'
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

  async function ask(question: string) {
    const trimmed = question.trim()
    if (tabId === null || stream.active || !trimmed) return

    setError(null)
    setTurns((prev) => [...prev, { role: 'user', content: trimmed }])

    // One call for every question: the model decides inside the loop whether to
    // search, so there's no page-first pass to branch on out here.
    const result = await stream.start(tabId, trimmed)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setTurns((prev) => [...prev, result.turn])
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

  return { turns: displayTurns, asking: stream.active, pendingStepLabel, error, ask, clear, historyLoaded }
}

function pendingLabel(step: Parameters<typeof describeStep>[0] | null): string {
  return step ? describeStep(step) : 'Thinking…'
}
