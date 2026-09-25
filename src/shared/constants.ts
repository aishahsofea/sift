export const TRUNCATION_CHAR_LIMIT = 120_000

// 20 turns = 10 user/assistant pairs of prior context sent with each new question.
export const MAX_HISTORY_TURNS = 20

// Tool rounds the model gets before the loop forces an answer (ADR 0001).
// Round MAX_TOOL_ROUNDS + 1 drops the tools and nudges (ADR 0003).
export const MAX_TOOL_ROUNDS = 3

// A fetch_page result is a whole article; the extracted page it joins in context
// can already be TRUNCATION_CHAR_LIMIT chars, so cap what one tool round adds.
export const FETCHED_PAGE_CHAR_LIMIT = 20_000

export const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1'
