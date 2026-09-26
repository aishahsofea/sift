import { useEffect, useState } from 'react'
import type { BackgroundRequest, BackgroundResponse } from '../../shared/messages'
import type { ChatTurn } from '../../shared/types'
import { describeStep } from '../stepLabel'
import { useAskStream } from './useAskStream'

export function useChat(tabId: number | null) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
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

  // The in-flight bubble carries no source label: which one is right is only known
  // once the loop reports the tool calls it actually made.
  const displayTurns: ChatTurn[] = stream.active
    ? [...turns, { role: 'assistant', content: stream.text || pendingLabel(stream.step) }]
    : turns

  return { turns: displayTurns, asking: stream.active, error, ask, clear }
}

function pendingLabel(step: Parameters<typeof describeStep>[0] | null): string {
  return step ? describeStep(step) : 'Thinking…'
}
