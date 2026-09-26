import ReactMarkdown from 'react-markdown'
import type { AnswerSource, ChatTurn } from '../../shared/types'
import { describeTruncatedAnswer } from '../truncationLabel'

const SOURCE_LABELS: Record<AnswerSource, string> = {
  page: 'from the page',
  web: 'from the web',
  'page+web': 'from the page and the web',
  // Says what it means rather than "made up": an unverified answer can still be
  // right, it just isn't tied to anything we supplied (ADR 0005).
  unverified: 'unverified · not traced to the page',
}

export function MessageBubble({ turn }: { turn: ChatTurn }) {
  return (
    <div className={`message-bubble message-bubble-${turn.role}`}>
      {turn.source && (
        <span
          className={`message-bubble-source${turn.source === 'unverified' ? ' message-bubble-source-unverified' : ''}`}
        >
          {SOURCE_LABELS[turn.source]}
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
