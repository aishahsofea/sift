import { NEBIUS_BASE_URL } from '../../shared/constants'
import type { PageGroundedResult } from '../../shared/types'
import { resolveNemotronModel } from './modelDiscovery'
import type { ChatMessage } from './promptAssembly'
import { PAGE_GROUNDED_RESPONSE_FORMAT, parsePageGroundedResult } from './schema'

export async function askPageGrounded(apiKey: string, messages: ChatMessage[]): Promise<PageGroundedResult> {
  const model = await resolveNemotronModel(apiKey)

  const res = await fetch(`${NEBIUS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: PAGE_GROUNDED_RESPONSE_FORMAT,
    }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`POST /chat/completions failed: ${res.status} ${text}`)
  }

  const body = JSON.parse(text) as { choices: { message: { content: string } }[] }
  const content = body.choices[0]?.message.content
  if (!content) {
    throw new Error('Nebius returned an empty response.')
  }

  const parsed = parsePageGroundedResult(content)
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }
  return parsed.result
}

// Tavily-fallback pass: streamed prose, no response_format. onChunk fires once
// per visible-answer delta; the resolved string is the full accumulated answer.
export async function streamFallbackAnswer(
  apiKey: string,
  messages: ChatMessage[],
  onChunk: (delta: string) => void,
): Promise<string> {
  const model = await resolveNemotronModel(apiKey)

  const res = await fetch(`${NEBIUS_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, stream: true }),
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`POST /chat/completions (stream) failed: ${res.status} ${text}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  // A single JSON `data:` payload can be split across two reader.read() calls,
  // so the trailing incomplete line must be buffered across reads, not assumed
  // to always contain whole lines (verified live against the real endpoint).
  let buffer = ''
  let fullText = ''
  let sawContent = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice('data:'.length).trim()
      if (data === '[DONE]') continue

      let parsed: { choices?: { delta?: { content?: string; reasoning?: string } }[] }
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }

      // delta.reasoning chunks stream before delta.content for this model —
      // only surface content once it arrives, never render raw chain-of-thought.
      const content = parsed.choices?.[0]?.delta?.content
      if (content) {
        sawContent = true
        fullText += content
        onChunk(content)
      }
    }
  }

  if (!sawContent) {
    throw new Error('Nebius returned no answer content.')
  }

  return fullText
}
