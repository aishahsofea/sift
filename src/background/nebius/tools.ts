// Tool definitions sent with every non-forced round, and the text that ends the
// loop. Both are verified prompt surface, not incidental strings: the wording was
// exercised by scripts/test-nebius-tools.mjs against the real endpoint
// (ADR 0001 / ADR 0003 / ADR 0005 / ADR 0006), so changing it means re-running
// `npm run test:tools`, whose copy of these definitions has to change with them.

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

// The page-side tool: the model quotes the page before answering from it, and the
// handler checks each quote against the page text (ADR 0005). It needs no network,
// so it is offered whether or not search is.
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

// The tool for a page too long for the prompt (#11, ADR 0006): a keyword search of the
// whole page, run in the extension, so it needs no network and is offered whether or not
// search is. The whole page and not only the part that was cut off, because the model
// can't reliably find a section in a 40,000-token head either; the part that was cut off
// still gets slots of its own in every result (searchPage), so a head that names a word
// often cannot hide the section the tool is there to reach.
export const SEARCH_PAGE_TOOL = {
  type: 'function',
  function: {
    name: SEARCH_PAGE,
    description:
      "Search the whole page, including the part that is cut off from the page content. Returns the passages that best match your words, each with the character offset it starts at. Use it when the question is about a part of the page that isn't in the page content.",
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

// cite_page as offered next to search_page. Same tool and same check, but a passage
// search_page returned is page text and can be cited, where the whole-page description
// says search results can't be — and it is checked against the whole page, not only the
// part in the prompt. Kept apart from CITE_TOOL so the wording verified for whole pages
// (ADR 0005) is not touched.
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

// Added to search_site and fetch_page results when cite_page is on offer. After a
// search the model cited the snippet ("it matches the page"), which is rejected, and
// the wasted rounds ran into the round cap. The system prompt saying so was not
// enough; said in the result, which the model reads last, and with the two-path
// prompt (promptAssembly.ts), cite_page calls after a search went from 11 of 12 runs
// to 0 of 47. Neither change alone was enough (ADR 0005).
export const SEARCH_NOTE =
  "These are search results, not the page content, so cite_page can't check them. Answer from them now, or search again."
export const FETCH_NOTE =
  "This is the full text of a fetched page, not the page content the user is viewing, so cite_page can't check it. Answer from it now."

// What cite_page's result says, and what it asks for when the model skipped it. All
// prompt surface, verified live like the tool wording (ADR 0005).
//
// Nothing verified: the way out is to try again, so the error carries the hint. Once
// something has verified the label has all it needs, and more calls only cost rounds
// (on real pages the model kept citing after every quote had verified: 3 calls, 12
// quotes), so the result says to stop.
export const CITE_RECOVERY_HINT =
  "Copy each passage exactly as it appears in the page content. If the page doesn't say it, don't cite it. Search results can't be cited."
export const CITE_DONE_NOTE = "All of these are on the page. Answer now from them, in your own words. Don't call cite_page again."
export const CITE_PARTIAL_NOTE = "Only the verified passages are on the page. Answer now using only those, and don't call cite_page again."
// Sent, for that one request, when the model answered a page question without
// calling cite_page: the answer is discarded and this asks again. It gives the model
// the way out of saying the page doesn't cover it, so it isn't pushed into quoting
// something that isn't there.
export const CITE_NUDGE =
  "Before you answer, call cite_page with up to three short passages from the page content that support your answer, copied word for word. If the page content doesn't cover the question, say so instead."
// The same ask on a page whose cut-off part search_page can reach: the passages may be
// there, so the way out includes looking, not only saying the page doesn't cover it.
export const CITE_NUDGE_CUT =
  "Before you answer, call cite_page with up to three short passages from the page that support your answer, copied word for word. If the passages are in the part that is cut off, call search_page for them first. If the page doesn't cover the question, say so instead."

// What search_page's result says. Like SEARCH_NOTE it is in the message the model reads
// last, because wording elsewhere was not enough to steer what it does next (ADR 0005):
// here, to turn what it found into a quote and then an answer, not into more searches.
// Prompt surface, verified live with the tool wording (ADR 0006).
export const PAGE_SEARCH_NOTE =
  'These passages are from the page, so cite_page can check them. Call cite_page with up to three short passages from them that support your answer, copied word for word, then answer. If none of them covers the question, search again with different words.'
export const PAGE_SEARCH_EMPTY_NOTE =
  'Nothing on the page matches those words. Search again with different words, or answer from what you have.'

interface ToolAvailability {
  /** A Tavily key is configured, so search_site and fetch_page can run. */
  searchEnabled: boolean
  /** The page can be quoted: it reached the model whole, or the rest of it can be checked against (ADR 0005, #11). */
  citeEnabled: boolean
  /** The page reached the model cut short and the rest of it was kept, so search_page can look through it (#11). */
  pageSearchEnabled: boolean
}

// What a round is offered. Empty when none is available, in which case no `tools`
// field is sent at all.
export function toolsFor({ searchEnabled, citeEnabled, pageSearchEnabled }: ToolAvailability) {
  return [
    ...(searchEnabled ? SEARCH_TOOLS : []),
    ...(pageSearchEnabled ? [SEARCH_PAGE_TOOL] : []),
    ...(citeEnabled ? [pageSearchEnabled ? CITE_TOOL_CUT : CITE_TOOL] : []),
  ]
}

export type ArgKind = 'string' | 'string[]'

// Required arguments per tool with the type each must have, keyed by name — the
// validator's allowlist of tool names doubles as this map (an unknown name has no entry).
export const REQUIRED_TOOL_ARGS: Record<string, Record<string, ArgKind>> = {
  [SEARCH_SITE]: { query: 'string' },
  [FETCH_PAGE]: { url: 'string' },
  [CITE_PAGE]: { quotes: 'string[]' },
  [SEARCH_PAGE]: { query: 'string' },
}

// Appended as a one-off user message on the forced final call, with `tools`
// omitted. Neither omitting the tools nor tool_choice: "none" is enough on its
// own — both make the model emit raw tool-call markup as its answer instead
// (0/5 clean answers each; with this nudge, 5/5). See ADR 0003.
export const FORCE_NUDGE =
  "You've used all your searches. Answer now from the page and the results above. If they don't cover the question, say you couldn't find it."

// On a whole page the model has been told to quote before it answers, so with the tools
// off it reached for cite_page anyway (real pages, follow-up questions: 2 of 5 runs
// ended in an error). The nudge above only says "searches", which leaves that
// instruction standing, so this one names cite_page and says no tool at all.
export const FORCE_NUDGE_CITE =
  "You've used all your tool calls, and cite_page is no longer available. Answer now, in plain text, from the page and the results above. If they don't cover the question, say you couldn't find it."

// Added, for that request only, when the forced round still comes back as a tool call:
// one more try before it becomes an error.
export const FORCE_RETRY = 'Do not call any tool. Write your answer as plain text now.'

// Tool-call syntax that should have been parsed into message.tool_calls. Reaching
// `content` means no tool parser was active, and rendering it would show markup
// as the answer (ADR 0003) — so a final answer carrying this is a failure,
// whichever round produced it.
const TOOL_MARKUP = /<\/?tool_?call>|<TOOLCALL>|<function[=\s>]/i

export function containsToolMarkup(text: string): boolean {
  return TOOL_MARKUP.test(text)
}
