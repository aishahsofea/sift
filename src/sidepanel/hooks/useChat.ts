import { useEffect, useRef, useState } from 'react'
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
  const lastQuestion = useRef('')

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

  // `editedIndex` is the turn being replaced: it and later turns go from the panel and, via `rewind`, from history.
  async function ask(question: string, editedIndex?: number) {
    const trimmed = question.trim()
    if (tabId === null || stream.active || !trimmed) return

    const { rewind, next } = replaceFrom(turns, trimmed, editedIndex)
    const rewound = next.slice(0, -1)
    setError(null)
    setTurns(next)
    lastQuestion.current = trimmed

    // One call for every question; the model decides inside the loop whether to search.
    const result = await stream.start(tabId, trimmed, rewind || undefined)
    if (!result.ok) {
      // A stopped answer isn't stored, so the question goes too, keeping the panel equal to history for later rewinds.
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

  // Returns the question that was running so the panel can put it back in the composer.
  function stop(): string {
    stream.stop()
    return lastQuestion.current
  }

  async function clear() {
    if (tabId === null) return
    const request: BackgroundRequest = { type: 'CLEAR_HISTORY', tabId }
    await chrome.runtime.sendMessage(request)
    setTurns([])
    setError(null)
  }

  // Nothing streamed yet: show the pending indicator; the in-flight bubble has no source label until the loop reports its tool calls.
  const hasStreamedText = stream.active && stream.text.length > 0
  const displayTurns: ChatTurn[] = hasStreamedText ? [...turns, { role: 'assistant', content: stream.text }] : turns
  const pendingStepLabel = stream.active && !hasStreamedText ? pendingLabel(stream.step) : null

  return { turns: displayTurns, asking: stream.active, pendingStepLabel, error, ask, reload, stop, clear, historyLoaded }
}

function pendingLabel(step: Parameters<typeof describeStep>[0] | null): string {
  return step ? describeStep(step) : 'Thinking…'
}
