import { useCallback, useRef, useState } from 'react'
import { ASK_PORT_NAME, type AskPortMessage, type AskPortRequest } from '../../shared/messages'
import type { AgentStep, ChatTurn } from '../../shared/types'

export type AskResult = { ok: true; turn: ChatTurn } | { ok: false; message: string } | { ok: false; stopped: true }

export function useAskStream() {
  const [active, setActive] = useState(false)
  const [text, setText] = useState('')
  const [step, setStep] = useState<AgentStep | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  const start = useCallback((tabId: number, question: string, rewind?: number): Promise<AskResult> => {
    setActive(true)
    setText('')
    setStep(null)

    return new Promise((resolve) => {
      const port = chrome.runtime.connect({ name: ASK_PORT_NAME })

      const settle = (result: AskResult) => {
        setActive(false)
        setStep(null)
        port.disconnect()
        stopRef.current = null
        resolve(result)
      }
      // Dropping the port is the signal: the background aborts its requests when it closes.
      stopRef.current = () => settle({ ok: false, stopped: true })

      port.onMessage.addListener((message: AskPortMessage) => {
        switch (message.type) {
          case 'ASK_STEP':
            // A step means this was a tool round, so text streamed before it wasn't the answer.
            setText('')
            setStep(message.step)
            break
          case 'ASK_CHUNK':
            setText((prev) => prev + message.delta)
            break
          case 'ASK_DONE':
            settle({ ok: true, turn: message.turn })
            break
          case 'ASK_ERROR':
            settle({ ok: false, message: message.message })
            break
        }
      })

      const request: AskPortRequest = { type: 'START_ASK', tabId, question, rewind }
      port.postMessage(request)
    })
  }, [])

  const stop = useCallback(() => stopRef.current?.(), [])

  return { active, text, step, start, stop }
}
