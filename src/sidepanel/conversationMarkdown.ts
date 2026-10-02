import type { ChatTurn } from '../shared/types'
import { describeSource } from './sourceLabel'
import { describeTruncatedAnswer } from './truncationLabel'

interface PageInfo {
  title: string
  url: string
}

function quoteBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
}

// Built from ChatTurn[], not from assistant-ui's messages, so each answer keeps the
// source label and checked quotes (#45).
export function buildConversationMarkdown(page: PageInfo, turns: readonly ChatTurn[]): string {
  const parts = [`# ${page.title || page.url}`, page.url]

  for (const turn of turns) {
    if (turn.role === 'user') {
      parts.push(`## Question\n\n${turn.content}`)
      continue
    }
    const lines = ['## Answer']
    if (turn.source) lines.push(`*Source: ${describeSource(turn.source, turn.quotes, { truncated: turn.truncated })}*`)
    lines.push(turn.content)
    if (turn.truncated && turn.charsOmitted !== undefined) lines.push(`*${describeTruncatedAnswer(turn.charsOmitted)}*`)
    if (turn.quotes?.length) lines.push(`**Quoted from the page:**\n\n${turn.quotes.map(quoteBlock).join('\n\n')}`)
    parts.push(lines.join('\n\n'))
  }

  return parts.join('\n\n') + '\n'
}

export function conversationFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  return `sift-${slug || 'conversation'}.md`
}
