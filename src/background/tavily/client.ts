import { withRetry } from '../../shared/withRetry'
import { scopeToDomain } from './scopeToDomain'

const TAVILY_BASE_URL = 'https://api.tavily.com'

export interface TavilySearchResult {
  title: string
  url: string
  content: string
}

export async function searchTavily(
  apiKey: string,
  question: string,
  pageUrl: string,
  pageTitle: string,
): Promise<TavilySearchResult[]> {
  const res = await withRetry(`${TAVILY_BASE_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      // A bare question ("what GPU is used to train this") carries no page
      // context, and basic-depth search on it can miss the very page the
      // question is about entirely (verified live — the article itself
      // didn't appear anywhere in 10 basic-depth results). Folding in the
      // page title fixes relevance; advanced depth fixes content quality.
      query: pageTitle ? `${question} (${pageTitle})` : question,
      search_depth: 'advanced',
      max_results: 5,
      include_domains: [scopeToDomain(pageUrl)],
    }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`POST /search failed: ${res.status} ${text}`)
  }

  const body = JSON.parse(text) as { results: { title: string; url: string; content: string }[] }
  return body.results.map((r) => ({ title: r.title, url: r.url, content: r.content }))
}
