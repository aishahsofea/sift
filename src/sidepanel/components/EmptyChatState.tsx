import { useState } from 'react'
import { pickGreeting } from '../greeting'

// Module-level so "never twice in a row" survives the unmount on first question and after Clear (#16).
let lastGreeting: string | undefined

export function EmptyChatState({ title }: { title: string }) {
  // Lazy initializer: picked once, not re-rolled per render.
  const [greeting] = useState(() => {
    const next = pickGreeting(title, Math.random, lastGreeting)
    lastGreeting = next
    return next
  })

  return (
    <div className="empty-chat-state">
      {/* Plain text, not a ChatTurn: a page title can contain markdown-like characters
          and must show up literally, not get parsed by MessageBubble's react-markdown. */}
      <div className="message-bubble message-bubble-assistant">{greeting}</div>
    </div>
  )
}
