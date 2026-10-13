import { useEffect, useRef, useState } from 'react'
import type { BackgroundRequest, BackgroundResponse } from '../../shared/messages'
import { capSelection } from '../../shared/truncate'
import type { AgentStep, ChatTurn } from '../../shared/types'
import { describeStep, describeStepDone } from '../stepLabel'
import { reloadTarget, replaceFrom } from '../rewind'
import { useAskStream } from './useAskStream'

export interface Pending {
  label: string
  done: string[]
}

export function useChat(tabId: number | null) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stream = useAskStream()
  const lastAsk = useRef<{ question: string; selection?: string }>({ question: '' })

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

  // `editedIndex` is the turn being replaced: it and later turns go from the panel and history.
  async function ask(question: string, editedIndex?: number, quoted?: string) {
    const trimmed = question.trim()
    if (tabId === null || stream.active || !trimmed) return

    // Capped here too, so the panel shows what the background stores.
    const { rewind, next } = replaceFrom(turns, trimmed, editedIndex, quoted ? capSelection(quoted).text : undefined)
    const rewound = next.slice(0, -1)
    const selection = next.at(-1)?.selection
    setError(null)
    setTurns(next)
    lastAsk.current = { question: trimmed, selection }

    // One call for every question; the model decides inside the loop whether to search.
    const result = await stream.start(tabId, trimmed, rewind || undefined, selection)
    if (!result.ok) {
      // A stopped answer isn't stored, so its question goes too, keeping the panel equal to history.
      if ('stopped' in result) setTurns(rewound)
      else setError(result.message)
      return
    }
    setTurns((prev) => [...prev, result.turn])
  }

  // Regenerate: the same path as an edit that changes nothing.
  async function reload(userIndex: number) {
    const target = reloadTarget(turns, userIndex)
    if (target) await ask(target.question, target.index, target.selection)
  }

  // Returns the question (and quote) that was running so the panel can put them back in the composer.
  function stop(): { question: string; selection?: string } {
    stream.stop()
    return lastAsk.current
  }

  async function clear() {
    if (tabId === null) return
    const request: BackgroundRequest = { type: 'CLEAR_HISTORY', tabId }
    await chrome.runtime.sendMessage(request)
    setTurns([])
    setError(null)
  }

  // Nothing streamed yet: show the pending indicator; the in-flight bubble has no source label yet.
  const hasStreamedText = stream.active && stream.text.length > 0
  const displayTurns: ChatTurn[] = hasStreamedText ? [...turns, { role: 'assistant', content: stream.text }] : turns
  const pending = stream.active && !hasStreamedText ? describePending(stream.steps) : null

  return { turns: displayTurns, asking: stream.active, pending, error, ask, reload, stop, clear, historyLoaded }
}

// The step running now is the last; the ones before it are done and stay listed.
function describePending(steps: AgentStep[]): Pending {
  const current = steps.at(-1)
  return { label: current ? describeStep(current) : 'Thinking…', done: steps.slice(0, -1).map(describeStepDone) }
}
