import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ActionBarPrimitive, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react'
import { describeSource, explainSource } from '../sourceLabel'
import { describeTruncatedAnswer } from '../truncationLabel'
import { PendingIndicator } from './PendingIndicator'
import { Table } from './MessageBubble'
import type { AnswerSource } from '../../shared/types'

function MarkdownText({ text }: { text: string }) {
  return (
    <div className="message-bubble-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: Table }}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

function Message() {
  const role = useAuiState((s) => s.message.role)
  const custom = useAuiState((s) => s.message.metadata.custom) as {
    source?: AnswerSource
    quotes?: string[]
    truncated?: boolean
    charsOmitted?: number
  }

  // assistant-ui adds an empty running assistant message the moment a question is sent;
  // the pending indicator covers that gap, so an empty bubble would double up.
  const isEmpty = useAuiState((s) => s.message.role === 'assistant' && s.message.parts.every((p) => p.type !== 'text' || !p.text))
  if (isEmpty) return null

  return (
    <MessagePrimitive.Root className={`message-bubble message-bubble-${role}`}>
      {custom.source && (
        <span
          className={`message-bubble-source${custom.source === 'unverified' ? ' message-bubble-source-unverified' : ''}`}
          title={explainSource(custom.source, { truncated: custom.truncated, quotes: custom.quotes?.length })}
        >
          {describeSource(custom.source, custom.quotes, { truncated: custom.truncated })}
        </span>
      )}
      <MessagePrimitive.Parts components={{ Text: ({ text }) => <MarkdownText text={text} /> }} />
      {custom.truncated && custom.charsOmitted !== undefined && (
        <p className="message-bubble-truncated">{describeTruncatedAnswer(custom.charsOmitted)}</p>
      )}
      {role === 'assistant' && (
        <ActionBarPrimitive.Root className="message-actions" hideWhenRunning>
          <ActionBarPrimitive.Copy className="message-action">Copy</ActionBarPrimitive.Copy>
          <ActionBarPrimitive.ExportMarkdown className="message-action">Export</ActionBarPrimitive.ExportMarkdown>
        </ActionBarPrimitive.Root>
      )}
    </MessagePrimitive.Root>
  )
}

export function AssistantThread({ pendingLabel }: { pendingLabel: string | null }) {
  return (
    <ThreadPrimitive.Root className="assistant-thread">
      <ThreadPrimitive.Viewport className="chat-thread">
        <ThreadPrimitive.Messages components={{ Message }} />
        {pendingLabel && <PendingIndicator label={pendingLabel} />}
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  )
}

export function AssistantComposer() {
  return (
    <ComposerPrimitive.Root className="chat-input">
      <ComposerPrimitive.Input placeholder="Ask about this page…" />
      <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  )
}
