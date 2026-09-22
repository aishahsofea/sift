import type { ChatTurn, ExtractedPage } from '../../shared/types'
import type { TavilySearchResult } from '../tavily/client'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function assemblePageGroundedMessages(
  page: ExtractedPage,
  history: ChatTurn[],
  question: string,
): ChatMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt(page) },
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: question },
  ]
}

function buildSystemPrompt(page: ExtractedPage): string {
  return [
    "You answer questions about a web page the user is currently viewing.",
    'Only use the page content below to answer — do not use outside knowledge.',
    'Respond with found_in_page: true and the answer when the page content answers the question.',
    "Respond with found_in_page: false when it doesn't, and give a brief answer explaining that this isn't covered on the page.",
    '',
    `Page title: ${page.title}`,
    `Page URL: ${page.url}`,
    'Page content:',
    page.content,
  ].join('\n')
}

export function assembleFallbackMessages(
  page: ExtractedPage,
  history: ChatTurn[],
  question: string,
  searchResults: TavilySearchResult[],
): ChatMessage[] {
  return [
    { role: 'system', content: buildFallbackSystemPrompt(page, searchResults) },
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: 'user', content: question },
  ]
}

function buildFallbackSystemPrompt(page: ExtractedPage, searchResults: TavilySearchResult[]): string {
  const hostname = new URL(page.url).hostname
  const sources = searchResults.length
    ? searchResults.map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.content}`).join('\n\n')
    : '(no results found)'

  return [
    `The answer wasn't on the page the user is viewing, so you searched ${hostname} on the web instead.`,
    'Answer the question using only the search results below — do not use outside knowledge.',
    "If the results don't cover it either, say so briefly.",
    '',
    'Search results:',
    sources,
  ].join('\n')
}
