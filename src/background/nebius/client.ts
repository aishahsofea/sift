import { NEBIUS_BASE_URL } from '../../shared/constants'
import { withRetry } from '../../shared/withRetry'
import { resolveNemotronModel } from './modelDiscovery'
import type { ChatMessage } from './promptAssembly'
import type { RawToolCall } from './schema'

export interface AgentTurn {
  /** Visible answer text, empty on a tool round. */
  content: string
  /** Unvalidated: names and arguments are whatever the model sent. */
  toolCalls: RawToolCall[]
}

interface StreamAgentTurnOptions {
  /** Omitted on the forced final round, which is what makes the model answer (ADR 0003). */
  tools?: unknown
  /** Fires per visible-answer delta. Never fires with leading or empty whitespace. */
  onContent: (delta: string) => void
}

// One round of the loop. Streamed whether or not it turns out to be the answer:
// which it is only becomes clear when tool calls do (or don't) arrive, and the
// answer round is the one that must stream.
export async function streamAgentTurn(
  apiKey: string,
  messages: ChatMessage[],
  { tools, onContent }: StreamAgentTurnOptions,
): Promise<AgentTurn> {
  const model = await resolveNemotronModel(apiKey)

  const res = await withRetry(`${NEBIUS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, stream: true, ...(tools ? { tools } : {}) }),
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`POST /chat/completions (stream) failed: ${res.status} ${text}`)
  }

  let content = ''
  // Tool calls stream as fragments keyed by index: id and name arrive first, then
  // the arguments JSON in pieces that only parse once joined (3 fragments on Nano).
  const calls: { id: string; name: string; argsText: string }[] = []

  const handleLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice('data:'.length).trim()
    if (data === '[DONE]') return

    let chunk: {
      error?: unknown
      choices?: {
        delta?: {
          content?: string
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
        }
      }[]
    }
    try {
      chunk = JSON.parse(data)
    } catch {
      return
    }
    if (chunk.error) throw new Error(`Nebius stream error: ${JSON.stringify(chunk.error)}`)

    const delta = chunk.choices?.[0]?.delta
    if (!delta) return

    // delta.reasoning (not reasoning_content on this wrapper) streams before
    // delta.content and is deliberately dropped — never render chain-of-thought.
    if (delta.content) {
      // A tool round still emits one whitespace-only content delta, and a real
      // answer starts with "\n". Swallowing leading whitespace here keeps both out
      // of the panel and out of stored history, rather than trimming downstream.
      const emit = content === '' ? delta.content.replace(/^\s+/, '') : delta.content
      if (emit) {
        content += emit
        onContent(emit)
      }
    }

    for (const part of delta.tool_calls ?? []) {
      const slot = (calls[part.index ?? 0] ??= { id: '', name: '', argsText: '' })
      if (part.id) slot.id = part.id
      if (part.function?.name) slot.name += part.function.name
      if (part.function?.arguments) slot.argsText += part.function.arguments
    }
  }

  // A single JSON `data:` payload can be split across two reader.read() calls, so
  // the trailing incomplete line is buffered across reads rather than assumed to
  // be whole (verified live against the real endpoint).
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(line)
  }
  for (const line of (buffer + decoder.decode()).split('\n')) handleLine(line)

  return { content, toolCalls: calls.filter(Boolean) }
}
