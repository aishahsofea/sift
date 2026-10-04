import { TAVILY_BASE_URL } from '../../shared/constants'
import { withRetry } from '../../shared/withRetry'
import { scopeToDomain } from './scopeToDomain'


export interface TavilySearchResult {
  title: string
  url: string
  content: string
}

// The model writes the query; the domain is pinned from the page URL, never model input (ADR 0001, ADR 0004).
export async function searchTavily(apiKey: string, query: string, pageUrl: string, baseUrl = TAVILY_BASE_URL, signal?: AbortSignal): Promise<TavilySearchResult[]> {
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
    signal,
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`POST /search failed: ${res.status} ${text}`)
  }

  const body = JSON.parse(text) as { results?: { title: string; url: string; content: string }[] }
  return (body.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content }))
}

// Whole text of one result, for when its snippet wasn't enough; only URLs from this turn's search (ADR 0004). Uncut: runTool decides how much fits (#7).
export async function extractTavily(apiKey: string, url: string, baseUrl = TAVILY_BASE_URL, signal?: AbortSignal): Promise<string> {
  const res = await withRetry(`${baseUrl}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, urls: [url] }),
    signal,
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`POST /extract failed: ${res.status} ${text}`)
  }

  const body = JSON.parse(text) as { results?: { url: string; raw_content?: string }[] }
  // A URL Tavily can't extract lands in failed_results: a tool-level outcome, not a request failure.
  return body.results?.[0]?.raw_content ?? ''
}
