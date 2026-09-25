import type { ChatTurn, ExtractedPage } from '../../shared/types'

export interface ToolCallPart {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCallPart[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface AgentPromptOptions {
  /** False when no Tavily key is configured, so the loop runs without tools. */
  searchEnabled: boolean
}

// The messages every round starts from. The page lives in this system message, so
// it is re-sent unchanged on each round of the loop: identical prefix, so Nano
// serves most of it from its prompt cache (21,120 of 23,454 tokens on a ~100K-char
// page), and page + search results can be combined in one answer — which the old
// two-pass fallback prompt could not do (ADR 0001).
export function assembleAgentMessages(
  page: ExtractedPage,
  history: ChatTurn[],
  question: string,
  options: AgentPromptOptions,
): ChatMessage[] {
  return [
    { role: 'system', content: buildAgentSystemPrompt(page, options) },
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: question },
  ]
}

function buildAgentSystemPrompt(page: ExtractedPage, { searchEnabled }: AgentPromptOptions): string {
  const site = new URL(page.url).hostname

  const toolInstructions = searchEnabled
    ? [
        `If it doesn't (or only covers part of it), call search_site to search ${site}. If the results don't help, search again with a better query.`,
        "If a result's snippet isn't enough, call fetch_page with that result's URL to read the page in full.",
      ]
    : // No Tavily key: the tools aren't sent this turn, so don't promise a search.
      ["You have no search available, so if the page doesn't cover the question, say so."]

  return [
    `You answer questions about the web page the user is viewing on ${site}.`,
    'Answer from the page content below whenever it covers the question.',
    ...toolInstructions,
    'Never answer from outside knowledge. If neither the page nor the search results cover the question, say so.',
    '',
    `Page title: ${page.title}`,
    `Page URL: ${page.url}`,
    'Page content:',
    page.content,
  ].join('\n')
}
