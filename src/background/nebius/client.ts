import { NEBIUS_BASE_URL, NEBIUS_STREAM_IDLE_TIMEOUT_MS } from '../../shared/constants'
import type { AgentTraceTiming, TokenUsage } from '../../shared/types'
import { withRetry } from '../../shared/withRetry'
import { resolveNemotronModel } from './modelDiscovery'
import type { ChatMessage } from './promptAssembly'
import type { RawToolCall } from './schema'

export interface AgentTurn {
  /** Visible answer text, empty on a tool round. */
  content: string
  /** Unvalidated: names and arguments are whatever the model sent. */
  toolCalls: RawToolCall[]
  // All five fields are optional so scripted `{content, toolCalls}` turns in tests typecheck (#18).
  /** resolveNemotronModel's pick for this round. */
  model?: string
  /** Absent when Nebius doesn't report usage for this round — never zeroed. */
  usage?: TokenUsage
  finishReason?: string
  /** Chain-of-thought text, captured for the trace only — never passed to onContent. */
  reasoning?: string
  timing?: AgentTraceTiming
}

interface StreamAgentTurnOptions {
  /** Omitted on the forced final round, which is what makes the model answer (ADR 0003). */
  tools?: unknown
  /** The demo proxy's /nebius path when the key is an install ID; the real API otherwise. */
  baseUrl?: string
  /** Aborts the request and the stream read, e.g. when the user stops the answer. */
  signal?: AbortSignal
  /** Fires per visible-answer delta. Never fires with leading or empty whitespace. */
  onContent: (delta: string) => void
}

// Streamed even if it isn't the answer, which is only known once tool calls do or don't arrive.
export async function streamAgentTurn(
  apiKey: string,
  messages: ChatMessage[],
  { tools, baseUrl = NEBIUS_BASE_URL, signal, onContent }: StreamAgentTurnOptions,
): Promise<AgentTurn> {
  // Start of this round's timing, before model resolution and the POST (real latency on a cold worker).
  const startedAt = Date.now()
  const model = await resolveNemotronModel(apiKey, baseUrl)

  // Aborts on silence, not total duration (#28); re-armed on every sign of life so long answers can stream.
  const controller = new AbortController()
  signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  if (signal?.aborted) controller.abort(signal.reason)
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const armIdleTimer = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      const seconds = NEBIUS_STREAM_IDLE_TIMEOUT_MS / 1000
      controller.abort(new Error(`Nebius stream timed out — no data for ${seconds}s. Try asking again.`))
    }, NEBIUS_STREAM_IDLE_TIMEOUT_MS)
  }

  try {
    armIdleTimer()
    const res = await withRetry(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(tools ? { tools } : {}),
      }),
      signal: controller.signal,
    })
    armIdleTimer()

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(`POST /chat/completions (stream) failed: ${res.status} ${text}`)
    }

    let firstByteAt: number | undefined
    let content = ''
    // Nemotron uses `reasoning`, other wrappers `reasoning_content` (AGENTS.md); trace only, never shown.
    let reasoning = ''
    let usage: TokenUsage | undefined
    let finishReason: string | undefined
    // Tool calls stream as fragments by index; the args JSON only parses once joined.
    const calls: { id: string; name: string; argsText: string }[] = []

    const handleLine = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      const data = trimmed.slice('data:'.length).trim()
      if (data === '[DONE]') return

      let chunk: {
        error?: unknown
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
          prompt_tokens_details?: { cached_tokens?: number }
        }
        choices?: {
          finish_reason?: string
          delta?: {
            content?: string
            reasoning?: string
            reasoning_content?: string
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

      // The terminal usage chunk has `choices: []`, so read it before the `!delta` guard.
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
          cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
        }
      }

      const choice = chunk.choices?.[0]
      if (choice?.finish_reason) finishReason = choice.finish_reason

      const delta = choice?.delta
      if (!delta) return

      const reasoningDelta = delta.reasoning ?? delta.reasoning_content
      if (reasoningDelta) reasoning += reasoningDelta

      if (delta.content) {
        // A tool round still emits a whitespace-only delta, and a real answer starts with "\n"; drop it here.
        const emit = content === '' ? delta.content.replace(/^\s+/, '') : delta.content
        if (emit) {
          content += emit
          firstByteAt ??= Date.now() - startedAt
          onContent(emit)
        }
      }

      for (const part of delta.tool_calls ?? []) {
        firstByteAt ??= Date.now() - startedAt
        const slot = (calls[part.index ?? 0] ??= { id: '', name: '', argsText: '' })
        if (part.id) slot.id = part.id
        if (part.function?.name) slot.name += part.function.name
        if (part.function?.arguments) slot.argsText += part.function.arguments
      }
    }

    // A `data:` payload can split across reads, so buffer the trailing incomplete line.
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      armIdleTimer()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
    }
    for (const line of (buffer + decoder.decode()).split('\n')) handleLine(line)

    return {
      content,
      toolCalls: calls.filter(Boolean),
      model,
      ...(usage ? { usage } : {}),
      ...(finishReason ? { finishReason } : {}),
      ...(reasoning ? { reasoning } : {}),
      timing: { durationMs: Date.now() - startedAt, ...(firstByteAt !== undefined ? { firstByteMs: firstByteAt } : {}) },
    }
  } finally {
    clearTimeout(idleTimer)
  }
}
