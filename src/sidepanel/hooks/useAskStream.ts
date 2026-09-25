import { useCallback, useState } from 'react'
import { ASK_PORT_NAME, type AskPortMessage, type AskPortRequest } from '../../shared/messages'
import type { AgentStep, ChatTurn } from '../../shared/types'

export type AskResult =
  | { ok: true; fullText: string; source: NonNullable<ChatTurn['source']> }
  | { ok: false; message: string }

export function useAskStream() {
  const [active, setActive] = useState(false)
  const [text, setText] = useState('')
  const [step, setStep] = useState<AgentStep | null>(null)

  const start = useCallback((tabId: number, question: string): Promise<AskResult> => {
    setActive(true)
    setText('')
    setStep(null)

    return new Promise((resolve) => {
      const port = chrome.runtime.connect({ name: ASK_PORT_NAME })

      const settle = (result: AskResult) => {
        setActive(false)
        setStep(null)
        port.disconnect()
        resolve(result)
      }

      port.onMessage.addListener((message: AskPortMessage) => {
        switch (message.type) {
          case 'ASK_STEP':
            // A step means this round was a tool round, so anything streamed into
            // the bubble before it was never part of the answer.
            setText('')
            setStep(message.step)
            break
          case 'ASK_CHUNK':
            setText((prev) => prev + message.delta)
            break
          case 'ASK_DONE':
            settle({ ok: true, fullText: message.fullText, source: message.source })
            break
          case 'ASK_ERROR':
            settle({ ok: false, message: message.message })
            break
        }
      })

      const request: AskPortRequest = { type: 'START_ASK', tabId, question }
      port.postMessage(request)
    })
  }, [])

  return { active, text, step, start }
}
