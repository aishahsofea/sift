import { useEffect, useState } from 'react'
import type { BackgroundRequest, BackgroundResponse } from '../../shared/messages'
import type { ChatTurn } from '../../shared/types'
import { useFallbackStream } from './useFallbackStream'

export function useChat(tabId: number | null) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fallback = useFallbackStream()

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
    if (tabId === null || pending || fallback.active || !trimmed) return

    setError(null)
    setPending(true)
    setTurns((prev) => [...prev, { role: 'user', content: trimmed }])

    let response: BackgroundResponse
    try {
      const request: BackgroundRequest = { type: 'ASK_QUESTION', tabId, question: trimmed }
      response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse
    } finally {
      setPending(false)
    }

    if (response.type !== 'ASK_QUESTION_RESULT') return

    if (!response.ok) {
      setError(response.message)
      return
    }

    if (response.result.found_in_page) {
      setTurns((prev) => [...prev, { role: 'assistant', content: response.result.answer, source: 'page' }])
      return
    }

    // Not found on the page — hand off to the Tavily fallback instead of
    // showing pass 1's "not covered on the page" text.
    const result = await fallback.start(tabId, trimmed)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setTurns((prev) => [...prev, { role: 'assistant', content: result.fullText, source: 'web' }])
  }

  async function clear() {
    if (tabId === null) return
    const request: BackgroundRequest = { type: 'CLEAR_HISTORY', tabId }
    await chrome.runtime.sendMessage(request)
    setTurns([])
    setError(null)
  }

  const displayTurns: ChatTurn[] = fallback.active
    ? [...turns, { role: 'assistant', content: fallback.text || 'Searching the web…', source: 'web' }]
    : turns

  return { turns: displayTurns, pending, fallbackActive: fallback.active, error, ask, clear }
}
