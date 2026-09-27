import { useState } from 'react'
import { pickGreeting } from '../greeting'

// Module-level, not component state: this component unmounts when the first question
// lands and remounts after Clear (#16), and the "never twice in a row" rule has to
// survive that round trip without making the picker itself impure.
let lastGreeting: string | undefined

export function EmptyChatState({ title }: { title: string }) {
  // Lazy initializer: picked once when the empty state appears, not re-rolled on
  // every re-render.
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
