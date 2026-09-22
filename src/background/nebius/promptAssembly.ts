import type { ChatTurn, ExtractedPage } from '../../shared/types'

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
