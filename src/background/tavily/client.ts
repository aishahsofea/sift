import { FETCHED_PAGE_CHAR_LIMIT } from '../../shared/constants'
import { truncate } from '../../shared/truncate'
import { withRetry } from '../../shared/withRetry'
import { scopeToDomain } from './scopeToDomain'

const TAVILY_BASE_URL = 'https://api.tavily.com'

export interface TavilySearchResult {
  title: string
  url: string
  content: string
}

// The model writes the query; the domain is pinned here from the page URL and is
// never model input (ADR 0001/0004). No page title is folded in any more: Phase 4
// needed that to rescue a bare user question, but the model is now instructed to
// write a self-contained query, and appending a title to it costs relevance.
export async function searchTavily(apiKey: string, query: string, pageUrl: string): Promise<TavilySearchResult[]> {
  const res = await withRetry(`${TAVILY_BASE_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'advanced',
      max_results: 5,
      include_domains: [scopeToDomain(pageUrl)],
    }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`POST /search failed: ${res.status} ${text}`)
  }

  const body = JSON.parse(text) as { results?: { title: string; url: string; content: string }[] }
  return (body.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content }))
}

// Full text of one search result, for when its snippet wasn't enough. The caller
// only passes URLs a search returned in this same turn (ADR 0004).
export async function extractTavily(apiKey: string, url: string): Promise<string> {
  const res = await withRetry(`${TAVILY_BASE_URL}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, urls: [url] }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`POST /extract failed: ${res.status} ${text}`)
  }

  const body = JSON.parse(text) as { results?: { url: string; raw_content?: string }[] }
  const raw = body.results?.[0]?.raw_content
  if (!raw) {
    // A URL Tavily can't extract lands in failed_results, not results. That's a
    // tool-level outcome the model can work around, not a request failure.
    return ''
  }
  return truncate(raw, FETCHED_PAGE_CHAR_LIMIT).content
}
