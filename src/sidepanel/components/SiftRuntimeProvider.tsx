import type { ReactNode } from 'react'
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react'
import type { ChatTurn } from '../../shared/types'

// useChat stays the source of truth (history, the background port); assistant-ui only
// renders. Sift's own fields ride along in metadata.custom so the grounding label survives.
function convertTurn(turn: ChatTurn, idx: number): ThreadMessageLike {
  return {
    id: `turn-${idx}`,
    role: turn.role,
    content: [{ type: 'text', text: turn.content }],
    metadata: {
      custom: { source: turn.source, quotes: turn.quotes, truncated: turn.truncated, charsOmitted: turn.charsOmitted },
    },
  }
}

interface Props {
  turns: ChatTurn[]
  isRunning: boolean
  onAsk: (question: string) => void
  children: ReactNode
}

export function SiftRuntimeProvider({ turns, isRunning, onAsk, children }: Props) {
  const runtime = useExternalStoreRuntime<ChatTurn>({
    messages: turns,
    isRunning,
    convertMessage: convertTurn,
    onNew: async (message) => {
      const text = message.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
      onAsk(text)
    },
  })
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}
