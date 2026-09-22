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
