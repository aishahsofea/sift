import { useCallback, useState } from 'react'
import { FALLBACK_PORT_NAME, type FallbackPortMessage, type FallbackPortRequest } from '../../shared/messages'

export type FallbackResult = { ok: true; fullText: string } | { ok: false; message: string }

export function useFallbackStream() {
  const [active, setActive] = useState(false)
  const [text, setText] = useState('')

  const start = useCallback((tabId: number, question: string): Promise<FallbackResult> => {
    setActive(true)
    setText('')

    return new Promise((resolve) => {
      const port = chrome.runtime.connect({ name: FALLBACK_PORT_NAME })

      port.onMessage.addListener((message: FallbackPortMessage) => {
        switch (message.type) {
          case 'FALLBACK_CHUNK':
            setText((prev) => prev + message.delta)
            break
          case 'FALLBACK_DONE':
            setActive(false)
            port.disconnect()
            resolve({ ok: true, fullText: message.fullText })
            break
          case 'FALLBACK_ERROR':
            setActive(false)
            port.disconnect()
            resolve({ ok: false, message: message.message })
            break
        }
      })

      const request: FallbackPortRequest = { type: 'START_FALLBACK', tabId, question }
      port.postMessage(request)
    })
  }, [])

  return { active, text, start }
}
