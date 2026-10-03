import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ActionBarPrimitive, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react'
import { describeSource, explainSource } from '../sourceLabel'
import { describeTruncatedAnswer } from '../truncationLabel'
import { PendingIndicator } from './PendingIndicator'
import { Table } from './MessageBubble'
import type { AnswerSource } from '../../shared/types'

export function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

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
  const isLast = useAuiState((s) => s.message.isLast)
  const isEditing = useAuiState((s) => s.message.composer.isEditing)
  if (isEmpty) return null

  if (isEditing) {
    return (
      <ComposerPrimitive.Root className="message-bubble message-bubble-user message-edit">
        <ComposerPrimitive.Input className="message-edit-input" autoFocus />
        <div className="message-actions">
          <ComposerPrimitive.Cancel className="message-action message-action-icon" aria-label="Cancel edit" title="Cancel edit">
            <Icon>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </Icon>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send className="message-action message-action-icon" aria-label="Resend" title="Resend">
            <Icon>
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22l-4-9-9-4Z" />
            </Icon>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    )
  }

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
      {role === 'user' && (
        <ActionBarPrimitive.Root className="message-actions" hideWhenRunning>
          <ActionBarPrimitive.Edit className="message-action message-action-icon" aria-label="Edit message" title="Edit message">
            <Icon>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </Icon>
          </ActionBarPrimitive.Edit>
        </ActionBarPrimitive.Root>
      )}
      {role === 'assistant' && (
        <ActionBarPrimitive.Root className="message-actions" hideWhenRunning>
          <ActionBarPrimitive.Copy copiedDuration={1500} className="message-action message-action-icon" aria-label="Copy answer" title="Copy answer">
            <span className="icon-copy">
              <Icon>
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </Icon>
            </span>
            <span className="icon-copied">
              <Icon>
                <path d="M20 6 9 17l-5-5" />
              </Icon>
            </span>
          </ActionBarPrimitive.Copy>
          {isLast && (
            <ActionBarPrimitive.Reload className="message-action message-action-icon" aria-label="Regenerate answer" title="Regenerate answer">
              <Icon>
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                <path d="M21 3v5h-5" />
              </Icon>
            </ActionBarPrimitive.Reload>
          )}
          <ActionBarPrimitive.ExportMarkdown className="message-action message-action-icon" aria-label="Export as Markdown" title="Export as Markdown">
            <Icon>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="m7 10 5 5 5-5" />
              <path d="M12 15V3" />
            </Icon>
          </ActionBarPrimitive.ExportMarkdown>
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
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send>Send</ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel>Stop</ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </ComposerPrimitive.Root>
  )
}
