import ReactMarkdown from 'react-markdown'
import type { ChatTurn } from '../../shared/types'
import { describeSource, explainSource } from '../sourceLabel'
import { describeTruncatedAnswer } from '../truncationLabel'

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
        <ReactMarkdown>{turn.content}</ReactMarkdown>
      </div>
      {turn.truncated && turn.charsOmitted !== undefined && (
        <p className="message-bubble-truncated">{describeTruncatedAnswer(turn.charsOmitted)}</p>
      )}
    </div>
  )
}
