import ReactMarkdown, { type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { JSX } from 'react'
import type { ChatTurn } from '../../shared/types'
import { describeSource, explainSource } from '../sourceLabel'
import { describeTruncatedAnswer } from '../truncationLabel'

// A bare <table> can't scroll on its own, and the bubble it sits in is only 85% of a
// narrow panel: wrap it so a wide table scrolls instead of pushing the panel sideways.
export function Table({ node: _node, ...props }: JSX.IntrinsicElements['table'] & ExtraProps) {
  return (
    <div className="message-bubble-table-wrap">
      <table {...props} />
    </div>
  )
}

export function MessageBubble({ turn }: { turn: ChatTurn }) {
  return (
    <div className={`message-bubble message-bubble-${turn.role}`}>
      {turn.source && (
        <span
          className={`message-bubble-source${turn.source === 'unverified' ? ' message-bubble-source-unverified' : ''}`}
          title={explainSource(turn.source, { truncated: turn.truncated, quotes: turn.quotes?.length })}
        >
          {describeSource(turn.source, turn.quotes, { truncated: turn.truncated })}
        </span>
      )}
      <div className="message-bubble-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ table: Table }}>
          {turn.content}
        </ReactMarkdown>
      </div>
      {turn.truncated && turn.charsOmitted !== undefined && (
        <p className="message-bubble-truncated">{describeTruncatedAnswer(turn.charsOmitted)}</p>
      )}
    </div>
  )
}
