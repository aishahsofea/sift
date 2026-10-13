import { MAX_WEB_PAGES } from '../../shared/constants'
import type { WebPage, WebPages } from '../../shared/types'

export interface FetchedPage {
  url: string
  partial: boolean
}

function parseHttp(url: string): URL | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined
  } catch {
    return undefined
  }
}

// Read pages come first; a found page already read is dropped. Titles fall back to the path.
export function buildWebPages(results: ReadonlyMap<string, string>, fetched: readonly FetchedPage[]): WebPages {
  const titleOf = (url: URL, title: string | undefined) => title?.trim() || `${url.pathname}${url.search}`

  const read: WebPage[] = []
  const readUrls = new Set<string>()
  for (const { url, partial } of fetched) {
    const parsed = parseHttp(url)
    if (!parsed || readUrls.has(url)) continue
    readUrls.add(url)
    read.push({ title: titleOf(parsed, results.get(url)), url, ...(partial ? { partial: true } : {}) })
  }

  const found: WebPage[] = []
  for (const [url, title] of results) {
    const parsed = parseHttp(url)
    if (!parsed || readUrls.has(url)) continue
    found.push({ title: titleOf(parsed, title), url })
  }

  return { read: read.slice(0, MAX_WEB_PAGES), found: found.slice(0, MAX_WEB_PAGES) }
}
