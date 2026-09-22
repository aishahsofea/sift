import type { PageGroundedResult } from '../../shared/types'

// response_format for the page-grounded pass — verified working against
// nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B, returns clean JSON in message.content.
export const PAGE_GROUNDED_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'page_grounded_result',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        found_in_page: { type: 'boolean' },
        answer: { type: 'string' },
      },
      required: ['found_in_page', 'answer'],
      additionalProperties: false,
    },
  },
} as const

export type ParsePageGroundedResult = { ok: true; result: PageGroundedResult } | { ok: false; error: string }

export function parsePageGroundedResult(raw: string): ParsePageGroundedResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Model response was not valid JSON.' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'Model response was not a JSON object.' }
  }

  const { found_in_page, answer } = parsed as Record<string, unknown>

  if (typeof found_in_page !== 'boolean') {
    return { ok: false, error: 'Model response is missing a boolean "found_in_page" field.' }
  }

  if (typeof answer !== 'string') {
    return { ok: false, error: 'Model response is missing a string "answer" field.' }
  }

  return { ok: true, result: { found_in_page, answer } }
}
