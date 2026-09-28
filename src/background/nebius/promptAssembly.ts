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

// How the model is told to answer, which depends on the tools it has. Verified prompt
// surface: scripts/test-nebius-tools.mjs keeps the same text and re-checks it live.
//
// With both tools, two explicit paths. cite_page belongs to the page path only:
// quote-then-answer (ADR 0005) has the model commit to passages before it writes
// claims, and the handler checks them against the page. Written as one line ("before
// you answer from the page, call cite_page"), Nano read it as a step in every answer
// and cited search snippets in 11 of 12 search runs, each wasting a round of the cap.
// Two paths, with the ban stated where the search path ends, plus the notes in the
// tool results (SEARCH_NOTE, FETCH_NOTE), took that to 0 of 47; neither alone did.
function answerInstructions(site: string, options: AgentPromptOptions): string[] {
  const { searchEnabled, citeEnabled, pageSearchEnabled } = options
  const intro = `You answer questions about the web page the user is viewing on ${site}.`

  // A cut-short page whose rest can be searched (#11, ADR 0006). The same two paths as
  // a whole page, with the page's own path gaining a step: find the passages first when
  // they are in the part the prompt doesn't hold. How much is cut is in the notice below.
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

// The text of the page as the system prompt presents it: what a cite_page quote is
// checked against (ADR 0005). Title and byline are in it because the model reads
// them as the page and answers from them — on Distill-style pages the byline is not
// in `content` at all (#6) — so a quote of them has to be able to verify. The URL is
// metadata, not page text.
//
// `content` is the page's whole text when the prompt holds only the head of it (#11):
// a quote is checked against the whole page, not just the part the model was given.
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
//
// When the rest of the page was kept (#11) the way out is search_page, which reaches the
// missing section itself; search_site would only find other pages of the site. Otherwise
// it is what it was: search the site, or say the page was cut off.
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
