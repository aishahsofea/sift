import { useEffect, useState } from 'react'
import type { BackgroundRequest, BackgroundResponse } from '../shared/messages'
import { AssistantComposer, AssistantThread, Icon } from './components/AssistantThread'
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
            <button onClick={copyConversation} className="header-action" aria-label="Copy conversation" title={copied ? 'Copied' : 'Copy conversation'}>
              <Icon>
                {copied ? (
                  <path d="M20 6 9 17l-5-5" />
                ) : (
                  <>
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </>
                )}
              </Icon>
            </button>
            <button onClick={downloadConversation} className="header-action" aria-label="Download as Markdown" title="Download as Markdown">
              <Icon>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="m7 10 5 5 5-5" />
                <path d="M12 15V3" />
              </Icon>
            </button>
            <span className="header-divider" aria-hidden="true" />
            <button onClick={clear} className="header-action header-action-danger" aria-label="Clear conversation" title="Clear conversation">
              <Icon>
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </Icon>
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
