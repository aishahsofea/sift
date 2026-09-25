// Tool definitions sent with every non-forced round, and the text that ends the
// loop. Both are verified prompt surface, not incidental strings: the wording was
// exercised by scripts/test-nebius-tools.mjs against the real endpoint
// (ADR 0001 / ADR 0003), so changing it means re-running `npm run test:tools`.

export const SEARCH_SITE = 'search_site'
export const FETCH_PAGE = 'fetch_page'

export const TOOLS = [
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

// Required string arguments per tool, keyed by name — the validator's allowlist
// of tool names doubles as this map (an unknown name has no entry).
export const REQUIRED_TOOL_ARGS: Record<string, readonly string[]> = {
  [SEARCH_SITE]: ['query'],
  [FETCH_PAGE]: ['url'],
}

// Appended as a one-off user message on the forced final call, with `tools`
// omitted. Neither omitting the tools nor tool_choice: "none" is enough on its
// own — both make the model emit raw tool-call markup as its answer instead
// (0/5 clean answers each; with this nudge, 5/5). See ADR 0003.
export const FORCE_NUDGE =
  "You've used all your searches. Answer now from the page and the results above. If they don't cover the question, say you couldn't find it."

// Tool-call syntax that should have been parsed into message.tool_calls. Reaching
// `content` means no tool parser was active, and rendering it would show markup
// as the answer (ADR 0003) — so a final answer carrying this is a failure,
// whichever round produced it.
const TOOL_MARKUP = /<\/?tool_?call>|<TOOLCALL>|<function[=\s>]/i

export function containsToolMarkup(text: string): boolean {
  return TOOL_MARKUP.test(text)
}
