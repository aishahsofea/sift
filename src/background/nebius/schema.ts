import { FETCH_PAGE, REQUIRED_TOOL_ARGS, SEARCH_SITE } from './tools'

export interface RawToolCall {
  id: string
  name: string
  /** Arguments exactly as the model sent them — a JSON string, echoed back verbatim. */
  argsText: string
}

export type ParsedToolCall =
  | { ok: true; id: string; name: typeof SEARCH_SITE; args: { query: string } }
  | { ok: true; id: string; name: typeof FETCH_PAGE; args: { url: string } }
  | { ok: false; id: string; error: string }

// Validates one tool call before anything is executed. Every rejection is
// recoverable: the caller hands the error back as the tool result and the model
// gets another round to correct itself, rather than the loop throwing (ADR 0004).
export function parseToolCall(call: RawToolCall): ParsedToolCall {
  const problems: string[] = []
  if (!call.id) problems.push('missing id')

  const required = REQUIRED_TOOL_ARGS[call.name]
  if (!required) problems.push(`unknown tool ${JSON.stringify(call.name)}`)

  let args: Record<string, unknown> | null = null
  try {
    const parsed: unknown = JSON.parse(call.argsText)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>
    }
  } catch {
    // reported below, same as a non-object payload
  }

  if (!args) {
    problems.push("arguments aren't a JSON object")
  } else {
    for (const key of required ?? []) {
      const value = args[key]
      if (typeof value !== 'string' || !value.trim()) problems.push(`missing "${key}" argument`)
    }
  }

  if (problems.length) {
    return { ok: false, id: call.id, error: `Invalid tool call: ${problems.join('; ')}` }
  }

  // Narrowed by the checks above: the name is a known tool and its required
  // arguments are non-empty strings.
  if (call.name === SEARCH_SITE) {
    return { ok: true, id: call.id, name: SEARCH_SITE, args: { query: (args as { query: string }).query } }
  }
  return { ok: true, id: call.id, name: FETCH_PAGE, args: { url: (args as { url: string }).url } }
}
