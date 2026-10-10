export const TRUNCATION_CHAR_LIMIT = 120_000

// A longer candidate means the selector matched a page wrapper, so it's rejected, not truncated.
export const BYLINE_CHAR_LIMIT = 1_000

// 20 turns = 10 user/assistant pairs of prior context sent with each new question.
export const MAX_HISTORY_TURNS = 20

// Most of a quoted page selection sent with a question; longer is cut with a marker.
export const MAX_SELECTION_CHARS = 2_000

// Tighter than MAX_HISTORY_TURNS: traces carry more text per round and the session quota is 10 MB (#18).
export const MAX_TRACE_RUNS = 15

// Tool rounds before the loop forces an answer (ADR 0001, ADR 0003); cite_page rounds count (ADR 0005).
export const MAX_TOOL_ROUNDS = 3

// Shorter quotes verify trivially against any page (ADR 0005); 10 lets "Dana Reyes" through.
export const MIN_QUOTE_CHARS = 10

// Caps what one fetch_page round adds to a context that may already hold TRUNCATION_CHAR_LIMIT chars.
export const FETCHED_PAGE_CHAR_LIMIT = 20_000

// Most of a page kept whole for search_page and cite_page (#11, ADR 0006); all or nothing.
export const RETAINED_PAGE_CHAR_LIMIT = 1_000_000

// Passage window width; PAGE_SEARCH_MAX_PASSAGES stays under FETCHED_PAGE_CHAR_LIMIT. Even, for half overlap.
export const PAGE_SEARCH_PASSAGE_CHARS = 1_500
export const PAGE_SEARCH_MAX_PASSAGES = 4
// Slots reserved past the prompt's cut so a head full of the word can't hide the section past it.
export const PAGE_SEARCH_CUT_PASSAGES = 2
// A cut fetch_page result's head is already in context, so its search spends every slot past the cut (#27).
export const PAGE_SEARCH_FETCH_PASSAGES = 6

export const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1'
export const TAVILY_BASE_URL = 'https://api.tavily.com'

// Demo proxy (worker/, #39), set at build time; empty means demo mode is off.
export const DEMO_PROXY_URL: string = (import.meta.env.VITE_DEMO_PROXY_URL ?? '').replace(/\/+$/, '')

// Idle timeout, reset on every chunk, not a cap on total duration; an untuned starting point (#28).
export const NEBIUS_STREAM_IDLE_TIMEOUT_MS = 30_000
