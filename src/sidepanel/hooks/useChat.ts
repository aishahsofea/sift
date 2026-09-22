import { useEffect, useState } from 'react'
import type { BackgroundRequest, BackgroundResponse } from '../../shared/messages'
import type { ChatTurn } from '../../shared/types'

export function useChat(tabId: number | null) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    if (tabId === null || pending || !trimmed) return

    setError(null)
    setPending(true)
    setTurns((prev) => [...prev, { role: 'user', content: trimmed }])

    try {
      const request: BackgroundRequest = { type: 'ASK_QUESTION', tabId, question: trimmed }
      const response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse
      if (response.type !== 'ASK_QUESTION_RESULT') return

      if (response.ok) {
        setTurns((prev) => [...prev, { role: 'assistant', content: response.result.answer, source: 'page' }])
      } else {
        setError(response.message)
      }
    } finally {
      setPending(false)
    }
  }

  async function clear() {
    if (tabId === null) return
    const request: BackgroundRequest = { type: 'CLEAR_HISTORY', tabId }
    await chrome.runtime.sendMessage(request)
    setTurns([])
    setError(null)
  }

  return { turns, pending, error, ask, clear }
}
