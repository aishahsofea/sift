import { CITE_PAGE, FETCH_PAGE, REQUIRED_TOOL_ARGS, SEARCH_SITE, type ArgKind } from './tools'

export interface RawToolCall {
  id: string
  name: string
  /** Arguments exactly as the model sent them — a JSON string, echoed back verbatim. */
  argsText: string
}

export type ParsedToolCall =
  | { ok: true; id: string; name: typeof SEARCH_SITE; args: { query: string } }
  | { ok: true; id: string; name: typeof FETCH_PAGE; args: { url: string } }
  | { ok: true; id: string; name: typeof CITE_PAGE; args: { quotes: string[] } }
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
    for (const [key, kind] of Object.entries(required ?? {})) {
      if (!isValidArg(args[key], kind)) problems.push(argProblem(key, kind))
    }
  }

  if (problems.length) {
    return { ok: false, id: call.id, error: `Invalid tool call: ${problems.join('; ')}` }
  }

  // Narrowed by the checks above: the name is a known tool and its required
  // arguments have the types it declares.
  if (call.name === SEARCH_SITE) {
    return { ok: true, id: call.id, name: SEARCH_SITE, args: { query: (args as { query: string }).query } }
  }
  if (call.name === CITE_PAGE) {
    return { ok: true, id: call.id, name: CITE_PAGE, args: { quotes: (args as { quotes: string[] }).quotes } }
  }
  return { ok: true, id: call.id, name: FETCH_PAGE, args: { url: (args as { url: string }).url } }
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isValidArg(value: unknown, kind: ArgKind): boolean {
  if (kind === 'string') return isNonBlankString(value)
  return Array.isArray(value) && value.length > 0 && value.every(isNonBlankString)
}

function argProblem(key: string, kind: ArgKind): string {
  return kind === 'string' ? `missing "${key}" argument` : `"${key}" must be a non-empty list of strings`
}
