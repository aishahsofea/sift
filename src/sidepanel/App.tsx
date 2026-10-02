import { useEffect, useState } from 'react'
import type { BackgroundRequest, BackgroundResponse } from '../shared/messages'
import { AssistantComposer, AssistantThread } from './components/AssistantThread'
import { SiftRuntimeProvider } from './components/SiftRuntimeProvider'
import { EmptyChatState } from './components/EmptyChatState'
import { MissingApiKeysState } from './components/MissingApiKeysState'
import { TruncationNotice } from './components/TruncationNotice'
import { UnreadablePageState } from './components/UnreadablePageState'
import { useActiveTab } from './hooks/useActiveTab'
import { useChat } from './hooks/useChat'
import { buildConversationMarkdown, conversationFilename } from './conversationMarkdown'

export default function App() {
  const { tabId, status } = useActiveTab()
  const { turns, asking, pendingStepLabel, error, ask, clear, historyLoaded } = useChat(tabId)
  const [nebiusConfigured, setNebiusConfigured] = useState<boolean | null>(null)

  useEffect(() => {
    const request: BackgroundRequest = { type: 'GET_API_KEY_STATUS' }
    chrome.runtime.sendMessage(request).then((response: BackgroundResponse) => {
      if (response.type === 'API_KEY_STATUS') setNebiusConfigured(response.nebiusConfigured)
    })
  }, [])

  const [copied, setCopied] = useState(false)

  const chatReady = status.state === 'ready' && nebiusConfigured === true

  const conversation = () =>
    status.state === 'ready' ? buildConversationMarkdown(status.page, turns) : ''

  const copyConversation = async () => {
    await navigator.clipboard.writeText(conversation())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const downloadConversation = () => {
    if (status.state !== 'ready') return
    const url = URL.createObjectURL(new Blob([conversation()], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = conversationFilename(status.page.title)
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main>
      <header className="app-header">
        <h1>Sift</h1>
        {chatReady && turns.length > 0 && (
          <div className="header-actions">
            <button onClick={copyConversation} className="clear-button">
              {copied ? 'Copied' : 'Copy conversation'}
            </button>
            <button onClick={downloadConversation} className="clear-button">
              Download .md
            </button>
            <button onClick={clear} className="clear-button">
              Clear
            </button>
          </div>
        )}
      </header>

      {status.state === 'loading' && <p>Reading page…</p>}
      {status.state === 'unreadable' && <UnreadablePageState reason={status.reason} message={status.message} />}
      {status.state === 'ready' && nebiusConfigured === false && <MissingApiKeysState />}

      {chatReady && (
        <SiftRuntimeProvider turns={turns} isRunning={asking} onAsk={ask}>
          {status.page.truncated && (
            <TruncationNotice charsOmitted={status.page.charsOmitted} searchable={status.page.searchable === true} />
          )}
          {historyLoaded && turns.length === 0 ? (
            <EmptyChatState title={status.page.title} />
          ) : (
            <AssistantThread pendingLabel={pendingStepLabel} />
          )}
          {error && (
            <p role="alert" className="chat-error">
              {error}
            </p>
          )}
          <AssistantComposer />
        </SiftRuntimeProvider>
      )}
    </main>
  )
}
