import { useEffect, useRef } from 'react'
import type { ChatTurn } from '../../shared/types'
import { MessageBubble } from './MessageBubble'

export function ChatThread({ turns }: { turns: ChatTurn[] }) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [turns])

  return (
    <div className="chat-thread">
      {turns.map((turn, i) => (
        <MessageBubble key={i} turn={turn} />
      ))}
      <div ref={endRef} />
    </div>
  )
}
