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
  /** False when no Tavily key is configured, so the search tools aren't sent. */
  searchEnabled: boolean
  /** Whether cite_page is offered, so the prompt only asks for it when it can be called. */
  citeEnabled: boolean
  /**
   * Whether search_page is offered: the page is cut short in this prompt and the rest
   * of it was kept (#11). Only ever on with `citeEnabled`, since a passage found there
   * is of no use to an answer that can't quote it.
   */
  pageSearchEnabled: boolean
}

// The page sits in the system message so every round re-sends an identical prefix that Nano serves from its prompt cache, and page plus search results can combine (ADR 0001).
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

// Verified prompt surface (scripts/test-nebius-tools.mjs keeps a copy). With both tools there are two explicit paths, with cite_page on the page path only; one line made Nano cite search snippets (ADR 0005).
function answerInstructions(site: string, options: AgentPromptOptions): string[] {
  const { searchEnabled, citeEnabled, pageSearchEnabled } = options
  const intro = `You answer questions about the web page the user is viewing on ${site}.`

  // Cut page whose rest is searchable (#11, ADR 0006): the page path gains a find-passages step.
  if (pageSearchEnabled) {
    const findFirst = 'If the passages you need are in the part that is cut off, call search_page to find them first.'
    if (searchEnabled) {
      return [
        `${intro} There are two ways to answer.`,
        `1. From the page, when it covers the question: first call cite_page with up to three short passages (a sentence or less each) that support your answer, copied word for word, then answer from them. ${findFirst}`,
        `2. From the site, when the page doesn't cover the question (or only part of it): call search_site to search ${site}, and search again with a better query if the results don't help. If a result's snippet isn't enough, call fetch_page with that result's URL. If that page comes back cut off too, call search_page to reach the rest of it. Then answer from the results. Don't call cite_page on this path: it only checks the page, never search_site or fetch_page results.`,
      ]
    }
    return [
      intro,
      `If the page covers the question, first call cite_page with up to three short passages (a sentence or less each) that support your answer, copied word for word, then answer from them. ${findFirst}`,
      "You can't search the rest of the site, so if the page doesn't cover the question, say so.",
    ]
  }

  if (searchEnabled && citeEnabled) {
    return [
      `${intro} There are two ways to answer.`,
      '1. From the page content below, when it covers the question: first call cite_page with up to three short passages (a sentence or less each) that support your answer, copied word for word, then answer from them.',
      `2. From the site, when the page content doesn't cover the question (or only part of it): call search_site to search ${site}, and search again with a better query if the results don't help. If a result's snippet isn't enough, call fetch_page with that result's URL. If that page comes back cut off too, call search_page to reach the rest of it. Then answer from the results. Don't call cite_page on this path: it only checks the page content below, never search or fetch results.`,
    ]
  }

  if (searchEnabled) {
    return [
      intro,
      'Answer from the page content below whenever it covers the question.',
      `If it doesn't (or only covers part of it), call search_site to search ${site}. If the results don't help, search again with a better query.`,
      "If a result's snippet isn't enough, call fetch_page with that result's URL to read the page in full. If that page comes back cut off too, call search_page to reach the rest of it.",
    ]
  }

  return [
    intro,
    citeEnabled
      ? 'If the page content below covers the question, first call cite_page with up to three short passages (a sentence or less each) that support your answer, copied word for word, then answer from them.'
      : 'Answer from the page content below whenever it covers the question.',
    // No Tavily key: the tools aren't sent this turn, so don't promise a search.
    "You have no search available, so if the page doesn't cover the question, say so.",
  ]
}

// What a cite_page quote is checked against (ADR 0005): title and byline are included since the model answers from them (#6); `content` is the whole page when only the head is in the prompt (#11); the URL is metadata.
export function pageText(page: ExtractedPage, content: string = page.content): string {
  return [page.title, page.byline, content].filter(Boolean).join('\n')
}

function buildAgentSystemPrompt(page: ExtractedPage, options: AgentPromptOptions): string {
  const site = new URL(page.url).hostname

  return [
    ...answerInstructions(site, options),
    'Never answer from outside knowledge. If neither the page nor the search results cover the question, say so.',
    ...truncationNotice(page, options),
    '',
    `Page title: ${page.title}`,
    `Page URL: ${page.url}`,
    // Own section above the content, labelled "on the page" so the model answers "who wrote this?" from it (#6).
    ...(page.byline
      ? ['Page byline, shown on the page (authors, affiliations, publication details):', page.byline]
      : []),
    'Page content:',
    page.content,
  ].join('\n')
}

// Without this the model reads a cut page as whole and never searches, even when a summary stands in for a cut section (#5, #12). Constant per page, so the cacheable prefix is stable; with the rest kept (#11) the way out is search_page, not search_site.
function truncationNotice(page: ExtractedPage, { searchEnabled, pageSearchEnabled }: AgentPromptOptions): string[] {
  if (!page.truncated) return []

  const omitted = page.charsOmitted.toLocaleString('en-US')
  const cut = `The page content below is cut off: its last ${omitted} characters are not included, so every section after the cut is missing. A section the content only names or summarizes is one of them, and a summary is not the section.`
  if (pageSearchEnabled) {
    return [
      `${cut} To answer a question about a missing section, call search_page with words from it: it searches the whole page, including the part that is cut off. Do not answer from the summary.`,
    ]
  }
  const action = searchEnabled ? 'call search_site for it' : 'say the page was cut off'
  return [`${cut} Do not answer a question about a missing section from the page: ${action}.`]
}
