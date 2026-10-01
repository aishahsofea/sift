import { TAVILY_BASE_URL } from '../../shared/constants'
import { withRetry } from '../../shared/withRetry'
import { scopeToDomain } from './scopeToDomain'


export interface TavilySearchResult {
  title: string
  url: string
  content: string
}

// The model writes the query; the domain is pinned here from the page URL and is
// never model input (ADR 0001/0004). No page title is folded in any more: Phase 4
// needed that to rescue a bare user question, but the model is now instructed to
// write a self-contained query, and appending a title to it costs relevance.
export async function searchTavily(apiKey: string, query: string, pageUrl: string, baseUrl = TAVILY_BASE_URL): Promise<TavilySearchResult[]> {
  const res = await withRetry(`${baseUrl}/search`, {
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

// Full text of one search result, for when its snippet wasn't enough. The caller only
// passes URLs a search returned in this same turn (ADR 0004). Returned whole, uncut:
// the caller (agentLoop.ts's runTool) is what decides how much of it fits in a tool
// result and keeps the rest for search_page to reach (#7) — this function has no
// opinion on that, the same way it has none on how the tab's own page is truncated.
export async function extractTavily(apiKey: string, url: string, baseUrl = TAVILY_BASE_URL): Promise<string> {
  const res = await withRetry(`${baseUrl}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, urls: [url] }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`POST /extract failed: ${res.status} ${text}`)
  }

  const body = JSON.parse(text) as { results?: { url: string; raw_content?: string }[] }
  // A URL Tavily can't extract lands in failed_results, not results. That's a
  // tool-level outcome the model can work around, not a request failure.
  return body.results?.[0]?.raw_content ?? ''
}
