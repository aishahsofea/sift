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
    ...truncationNotice(page, searchEnabled),
    '',
    `Page title: ${page.title}`,
    `Page URL: ${page.url}`,
    // Its own section, above the content: on Distill-style pages this text is not
    // in page.content at all, and it is what answers "who wrote this?" (#6). The
    // label says "on the page" so the model reads it as page content to answer
    // from, not as outside knowledge it has been told never to use.
    ...(page.byline
      ? ['Page byline, shown on the page (authors, affiliations, publication details):', page.byline]
      : []),
    'Page content:',
    page.content,
  ].join('\n')
}

// Without this the model reads a cut page as the whole page, so "the page doesn't
// cover it, search" has nothing to fire on — even when it can see a heading and a
// summary for a section whose body was cut (#5, #12). It names the cut in chars, and
// says outright that a summary is not the section: given an answer-shaped summary,
// Nano sometimes counts the question as covered and answers without searching.
// Constant for a given page, so it doesn't disturb the cacheable prefix.
function truncationNotice(page: ExtractedPage, searchEnabled: boolean): string[] {
  if (!page.truncated) return []

  const omitted = page.charsOmitted.toLocaleString('en-US')
  const action = searchEnabled ? 'call search_site for it' : 'say the page was cut off'
  return [
    `The page content below is cut off: its last ${omitted} characters are not included, so every section after the cut is missing. A section the content only names or summarizes is one of them, and a summary is not the section. Do not answer a question about a missing section from the page: ${action}.`,
  ]
}
