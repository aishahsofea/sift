import { useEffect, useRef } from 'react'
import type { ChatTurn } from '../../shared/types'
import { MessageBubble } from './MessageBubble'
import { PendingIndicator } from './PendingIndicator'

export function ChatThread({ turns, pendingLabel }: { turns: ChatTurn[]; pendingLabel: string | null }) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [turns, pendingLabel])

  return (
    <div className="chat-thread">
      {turns.map((turn, i) => (
        <MessageBubble key={i} turn={turn} />
      ))}
      {pendingLabel && <PendingIndicator label={pendingLabel} />}
      <div ref={endRef} />
    </div>
  )
}
