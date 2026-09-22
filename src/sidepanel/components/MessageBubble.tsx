import type { ChatTurn } from '../../shared/types'

const SOURCE_LABELS: Record<NonNullable<ChatTurn['source']>, string> = {
  page: 'from the page',
  web: 'from the web',
}

export function MessageBubble({ turn }: { turn: ChatTurn }) {
  return (
    <div className={`message-bubble message-bubble-${turn.role}`}>
      {turn.source && <span className="message-bubble-source">{SOURCE_LABELS[turn.source]}</span>}
      <p>{turn.content}</p>
    </div>
  )
}
