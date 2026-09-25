import { useEffect, useState } from 'react'
import type { BackgroundRequest, BackgroundResponse } from '../shared/messages'
import { ChatInput } from './components/ChatInput'
import { ChatThread } from './components/ChatThread'
import { MissingApiKeysState } from './components/MissingApiKeysState'
import { UnreadablePageState } from './components/UnreadablePageState'
import { useActiveTab } from './hooks/useActiveTab'
import { useChat } from './hooks/useChat'

export default function App() {
  const { tabId, status } = useActiveTab()
  const { turns, asking, error, ask, clear } = useChat(tabId)
  const [nebiusConfigured, setNebiusConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    const request: BackgroundRequest = { type: 'GET_API_KEY_STATUS' }
    chrome.runtime.sendMessage(request).then((response: BackgroundResponse) => {
      if (response.type === 'API_KEY_STATUS') setNebiusConfigured(response.nebiusConfigured)
    })
  }, [])

  const chatReady = status.state === 'ready' && nebiusConfigured === true

  return (
    <main>
      <header className="app-header">
        <h1>Sift</h1>
        {chatReady && turns.length > 0 && (
          <button onClick={clear} className="clear-button">
            Clear
          </button>
        )}
      </header>

      {status.state === 'loading' && <p>Reading page…</p>}
      {status.state === 'unreadable' && <UnreadablePageState reason={status.reason} message={status.message} />}
      {status.state === 'ready' && nebiusConfigured === false && <MissingApiKeysState />}

      {chatReady && (
        <>
          <ChatThread turns={turns} />
          {error && (
            <p role="alert" className="chat-error">
              {error}
            </p>
          )}
          <ChatInput onSend={ask} disabled={asking} />
        </>
      )}
    </main>
  )
}
