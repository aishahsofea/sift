export const TRUNCATION_CHAR_LIMIT = 120_000

// A byline is a handful of names plus affiliations and footnote legends; a
// candidate longer than this means the selector matched a page wrapper, so it's
// rejected rather than truncated (see src/content/byline.ts).
export const BYLINE_CHAR_LIMIT = 1_000

// 20 turns = 10 user/assistant pairs of prior context sent with each new question.
export const MAX_HISTORY_TURNS = 20

// Tool rounds the model gets before the loop forces an answer (ADR 0001).
// Round MAX_TOOL_ROUNDS + 1 drops the tools and nudges (ADR 0003). A cite_page
// round counts against this like any other (ADR 0005).
export const MAX_TOOL_ROUNDS = 3

// A cite_page quote shorter than this (after whitespace is collapsed) is rejected.
// Almost any page contains a word or two, so a short "quote" verifies without tying
// the answer to anything (ADR 0005). 10 lets a name like "Dana Reyes" through.
export const MIN_QUOTE_CHARS = 10

// A fetch_page result is a whole article; the extracted page it joins in context
// can already be TRUNCATION_CHAR_LIMIT chars, so cap what one tool round adds.
export const FETCHED_PAGE_CHAR_LIMIT = 20_000

export const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1'
