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
  // The five fields below are all optional, including `model`, so the existing scripted
  // `{content, toolCalls}` turns in agentLoop.test.ts keep typechecking unchanged (#18).
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
  // Marks this round's start for `timing` below — before model resolution and the POST,
  // both of which are real, attributable latency on a cold service worker.
  const startedAt = Date.now()
  const model = await resolveNemotronModel(apiKey)

  // Aborts on silence, not on total duration (#28): a stall during connect or between
  // chunks means Nebius has stopped sending bytes, and nothing else here would ever
  // notice. Re-armed below on every sign of life; a real answer can stream past the
  // timeout as long as it keeps sending.
  const controller = new AbortController()
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
    const res = await withRetry(`${NEBIUS_BASE_URL}/chat/completions`, {
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
    // Nemotron streams chain-of-thought under `reasoning`; other OpenAI-compatible
    // wrappers use `reasoning_content` (AGENTS.md: check both). Buffered for the trace
    // only — never passed to onContent, so it never reaches the panel or history.
    let reasoning = ''
    let usage: TokenUsage | undefined
    let finishReason: string | undefined
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

      // stream_options.include_usage's terminal chunk carries usage with choices: [] — read
      // it here, ahead of the `!delta` guard below, or it's never seen.
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
        // A tool round still emits one whitespace-only content delta, and a real
        // answer starts with "\n". Swallowing leading whitespace here keeps both out
        // of the panel and out of stored history, rather than trimming downstream.
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

    // A single JSON `data:` payload can be split across two reader.read() calls, so
    // the trailing incomplete line is buffered across reads rather than assumed to
    // be whole (verified live against the real endpoint).
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
