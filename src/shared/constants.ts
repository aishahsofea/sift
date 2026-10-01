export const TRUNCATION_CHAR_LIMIT = 120_000

// A byline is a handful of names plus affiliations and footnote legends; a
// candidate longer than this means the selector matched a page wrapper, so it's
// rejected rather than truncated (see src/content/byline.ts).
export const BYLINE_CHAR_LIMIT = 1_000

// 20 turns = 10 user/assistant pairs of prior context sent with each new question.
export const MAX_HISTORY_TURNS = 20

// Tighter than MAX_HISTORY_TURNS: a run can have more rounds carrying more text per round
// once the trace content toggle is on, so a smaller bound keeps the shared 10 MB
// chrome.storage.session quota comfortable (#18).
export const MAX_TRACE_RUNS = 15

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

// The most of a page kept whole for search_page and cite_page once it outgrows the
// prompt (#11, ADR 0006). It is all or nothing: a page longer than this keeps only its
// head, as before, rather than a second cut that search_page couldn't explain. About
// eight times the prompt limit, and small enough that a few of them fit in the 10 MB
// chrome.storage.session quota.
export const RETAINED_PAGE_CHAR_LIMIT = 1_000_000

// One search_page passage is a window this many characters wide, and one call returns
// at most PAGE_SEARCH_MAX_PASSAGES of them, so a round adds at most 6,000 characters —
// well under FETCHED_PAGE_CHAR_LIMIT, the cap on what a fetch_page round adds. Even, so
// the windows overlap by exactly half.
export const PAGE_SEARCH_PASSAGE_CHARS = 1_500
export const PAGE_SEARCH_MAX_PASSAGES = 4
// How many of those slots go to the part of the page the prompt doesn't hold before the
// rest are filled by rank. The search covers the whole page, since the model can't
// reliably find things in a 40,000-token head either; without this, a head that says the
// word more often than the section past the cut would fill every slot and hide it.
export const PAGE_SEARCH_CUT_PASSAGES = 2
// A cut fetch_page result already has its head in the model's context, so its search
// skips the head and spends every slot past the cut (#27). Six passages are about 9,000
// characters, still under FETCHED_PAGE_CHAR_LIMIT.
export const PAGE_SEARCH_FETCH_PASSAGES = 6

export const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1'

// Aborts a chat-completions stream that has gone silent for this long — reset on every
// chunk, not a cap on the request's total duration, which would kill a legitimately
// long-streaming answer. No per-chunk cadence data was available to tune this precisely:
// a starting point, worth revisiting with real numbers (#28).
export const NEBIUS_STREAM_IDLE_TIMEOUT_MS = 30_000
