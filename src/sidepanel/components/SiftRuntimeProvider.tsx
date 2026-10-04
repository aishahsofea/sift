import type { ReactNode } from 'react'
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from '@assistant-ui/react'
import type { ChatTurn } from '../../shared/types'

// useChat stays the source of truth; assistant-ui only renders, with Sift's fields in metadata.custom.
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
  onAsk: (question: string, editedIndex?: number) => void
  onReload: (userIndex: number) => void
  /** Stops the running answer and returns its question. */
  onStop: () => string
  children: ReactNode
}

export function SiftRuntimeProvider({ turns, isRunning, onAsk, onReload, onStop, children }: Props) {
  const textOf = (message: AppendMessage) => message.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
  const runtime = useExternalStoreRuntime<ChatTurn>({
    messages: turns,
    isRunning,
    convertMessage: convertTurn,
    onCancel: async (): Promise<void> => {
      runtime.thread.composer.setText(onStop())
    },
    onNew: async (message) => onAsk(textOf(message)),
    onEdit: async (message) => {
      const index = Number(message.sourceId?.replace('turn-', ''))
      onAsk(textOf(message), Number.isInteger(index) ? index : undefined)
    },
    onReload: async (parentId) => {
      const index = Number(parentId?.replace('turn-', ''))
      if (Number.isInteger(index)) onReload(index)
    },
  })
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}
