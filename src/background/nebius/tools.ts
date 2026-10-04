// Tool definitions and loop-ending text are verified prompt surface: re-run `npm run test:tools` on change.

export const SEARCH_SITE = 'search_site'
export const FETCH_PAGE = 'fetch_page'
export const CITE_PAGE = 'cite_page'
export const SEARCH_PAGE = 'search_page'

const SEARCH_TOOLS = [
  {
    type: 'function',
    function: {
      name: SEARCH_SITE,
      description:
        'Search the site the user is viewing. Returns titles, URLs and short snippets. The site is fixed, so pass only the query.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              "A self-contained search query. Resolve references from the conversation: use names, not 'she' or 'it'.",
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: FETCH_PAGE,
      description: "Read the full text of a page returned by search_site, when its snippet isn't enough.",
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'A URL exactly as search_site returned it.' },
        },
        required: ['url'],
      },
    },
  },
] as const

// The model quotes the page before answering and the handler checks each quote (ADR 0005); no network.
export const CITE_TOOL = {
  type: 'function',
  function: {
    name: CITE_PAGE,
    description:
      "Quote the passages of the page content that support your answer. Call it before you answer from the page content; search and fetch results can't be cited. Each quote is checked against the page content, so copy it word for word: a quote that isn't found is rejected.",
    parameters: {
      type: 'object',
      properties: {
        quotes: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Up to three short passages, each a sentence or less, copied exactly from the page content: no paraphrasing, no ellipses.',
        },
      },
      required: ['quotes'],
    },
  },
} as const

// Local keyword search of the whole page (#11, ADR 0006); also offered once a fetch_page result is cut (#7).
export const SEARCH_PAGE_TOOL = {
  type: 'function',
  function: {
    name: SEARCH_PAGE,
    description:
      "Search the whole page, including the part that is cut off from the page content, or the text of a page you fetched with fetch_page if that came back cut off too. Returns the passages that best match your words, each with the character offset it starts at. Use it when the question is about a part that isn't in what you were given.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "The words to look for, as they'd be written on the page: names and key terms, not a whole question.",
        },
      },
      required: ['query'],
    },
  },
} as const

// cite_page beside search_page: its passages are citable; kept apart from CITE_TOOL's wording (ADR 0005).
export const CITE_TOOL_CUT = {
  ...CITE_TOOL,
  function: {
    ...CITE_TOOL.function,
    description:
      "Quote the passages of the page that support your answer. Call it before you answer from the page, whether the passages are in the page content or came from search_page; search_site and fetch_page results can't be cited. Each quote is checked against the whole page, so copy it word for word: a quote that isn't found is rejected.",
    parameters: {
      ...CITE_TOOL.function.parameters,
      properties: {
        quotes: {
          ...CITE_TOOL.function.parameters.properties.quotes,
          description:
            'Up to three short passages, each a sentence or less, copied exactly from the page: no paraphrasing, no ellipses.',
        },
      },
    },
  },
} as const

// Appended to search_site and fetch_page results, which the model reads last (ADR 0005, 0009).
export const SEARCH_NOTE =
  "These are search results, not the page content, so cite_page can't check them. If a snippet has the answer, use it now. If none does, call fetch_page with that result's URL to read it in full, or search again with a better query."
export const FETCH_NOTE =
  "This is the full text of a fetched page, not the page content the user is viewing, so cite_page can't check it. Answer from it now."

// FETCH_NOTE's cut counterpart (#7); shown even without cite_page, the only place the cut is announced.
export function FETCH_NOTE_CUT(charsOmitted: number): string {
  const omitted = charsOmitted.toLocaleString('en-US')
  return `This is the fetched page, not the page content the user is viewing, so cite_page can't check it either way. It is cut off too: its last ${omitted} characters are not included. If it doesn't have the answer, call search_page with words from the missing part to reach it.`
}

// cite_page result text (ADR 0005): errors carry a retry hint; once anything verifies, it says stop.
export const CITE_RECOVERY_HINT =
  "Copy each passage exactly as it appears in the page content. If the page doesn't say it, don't cite it. Search results can't be cited."
export const CITE_DONE_NOTE = "All of these are on the page. Answer now from them, in your own words. Don't call cite_page again."
export const CITE_PARTIAL_NOTE = "Only the verified passages are on the page. Answer now using only those, and don't call cite_page again."
// Sent for one request when a page question was answered without cite_page; leaves room to say not covered.
export const CITE_NUDGE =
  "Before you answer, call cite_page with up to three short passages from the page content that support your answer, copied word for word. If the page content doesn't cover the question, say so instead."
// Same ask on a cut page, where the way out includes searching the rest.
export const CITE_NUDGE_CUT =
  "Before you answer, call cite_page with up to three short passages from the page that support your answer, copied word for word. If the passages are in the part that is cut off, call search_page for them first. If the page doesn't cover the question, say so instead."

// search_page result text, read last to turn findings into a quote and answer, not more searches (ADR 0005).
export const PAGE_SEARCH_NOTE =
  'These passages are from the page, so cite_page can check them. Call cite_page with up to three short passages from them that support your answer, copied word for word, then answer. If none of them covers the question, search again with different words.'
export const PAGE_SEARCH_EMPTY_NOTE =
  'Nothing on the page matches those words. Search again with different words, or answer from what you have.'

// search_page notes for a fetched page: no quote request, since cite_page never checks fetched content.
export const PAGE_SEARCH_NOTE_FETCHED =
  "These passages are from the fetched page, not the page you're viewing, so cite_page can't check them. Answer from them now, or search again with different words."
export const PAGE_SEARCH_EMPTY_NOTE_FETCHED =
  'Nothing past the start of the fetched page matches those words. Search again with different words, or answer from what you have.'

interface ToolAvailability {
  /** A Tavily key is configured, so search_site and fetch_page can run. */
  searchEnabled: boolean
  /** The page can be quoted: it reached the model whole, or the rest of it can be checked against (ADR 0005, #11). */
  citeEnabled: boolean
  /** The page reached the model cut short and the rest of it was kept, so search_page can look through it (#11). */
  pageSearchEnabled: boolean
}

// What a round is offered; empty means no `tools` field is sent.
export function toolsFor({ searchEnabled, citeEnabled, pageSearchEnabled }: ToolAvailability) {
  return [
    ...(searchEnabled ? SEARCH_TOOLS : []),
    ...(pageSearchEnabled ? [SEARCH_PAGE_TOOL] : []),
    ...(citeEnabled ? [pageSearchEnabled ? CITE_TOOL_CUT : CITE_TOOL] : []),
  ]
}

export type ArgKind = 'string' | 'string[]'

// Required arguments and their types per tool; doubles as the allowlist of tool names.
export const REQUIRED_TOOL_ARGS: Record<string, Record<string, ArgKind>> = {
  [SEARCH_SITE]: { query: 'string' },
  [FETCH_PAGE]: { url: 'string' },
  [CITE_PAGE]: { quotes: 'string[]' },
  [SEARCH_PAGE]: { query: 'string' },
}

// One-off user message on the forced final call, with `tools` omitted; neither alone stops markup (ADR 0003).
export const FORCE_NUDGE =
  "You've used all your searches. Answer now from the page and the results above. If they don't cover the question, say you couldn't find it."

// Names cite_page too: with tools off, the model still reached for it after the plain nudge.
export const FORCE_NUDGE_CITE =
  "You've used all your tool calls, and cite_page is no longer available. Answer now, in plain text, from the page and the results above. If they don't cover the question, say you couldn't find it."

// One more try, for that request only, when the forced round still returns a tool call.
export const FORCE_RETRY = 'Do not call any tool. Write your answer as plain text now.'

// Tool-call syntax in `content` means no tool parser ran (ADR 0003); a final answer with it is a failure.
const TOOL_MARKUP = /<\/?tool_?call>|<TOOLCALL>|<function[=\s>]/i

export function containsToolMarkup(text: string): boolean {
  return TOOL_MARKUP.test(text)
}
