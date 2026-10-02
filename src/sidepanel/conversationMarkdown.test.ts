import { describe, expect, it } from 'vitest'
import type { ChatTurn } from '../shared/types'
import { buildConversationMarkdown, conversationFilename } from './conversationMarkdown'

const page = { title: 'Pricing', url: 'https://example.com/pricing' }

describe('buildConversationMarkdown', () => {
  it('names the page at the top', () => {
    const md = buildConversationMarkdown(page, [])
    expect(md.startsWith('# Pricing\n\nhttps://example.com/pricing')).toBe(true)
  })

  it('falls back to the URL when the page has no title', () => {
    expect(buildConversationMarkdown({ title: '', url: page.url }, [])).toContain('# https://example.com/pricing')
  })

  it('labels each answer with its source and lists the checked quotes', () => {
    const turns: ChatTurn[] = [
      { role: 'user', content: 'What does Pro cost?' },
      { role: 'assistant', content: 'Pro is $12.', source: 'page', quotes: ['Pro: $12 per month\nbilled yearly'] },
    ]
    const md = buildConversationMarkdown(page, turns)
    expect(md).toContain('## Question\n\nWhat does Pro cost?')
    expect(md).toContain('## Answer')
    expect(md).toContain('*Source: from the page · 1 quote checked*')
    expect(md).toContain('> Pro: $12 per month\n> billed yearly')
  })

  it('omits the source line and quotes when an answer has none', () => {
    const md = buildConversationMarkdown(page, [{ role: 'assistant', content: 'Hi' }])
    expect(md).not.toContain('Source:')
    expect(md).not.toContain('Quoted')
  })

  it('notes an answer written from a cut-short page', () => {
    const md = buildConversationMarkdown(page, [
      { role: 'assistant', content: 'x', source: 'unverified', truncated: true, charsOmitted: 5000 },
    ])
    expect(md).toContain('not checked · page was cut short')
  })
})

describe('conversationFilename', () => {
  it('slugs the title', () => {
    expect(conversationFilename('Pricing – Acme, Inc.')).toBe('sift-pricing-acme-inc.md')
  })

  it('has a fallback for an empty title', () => {
    expect(conversationFilename('')).toBe('sift-conversation.md')
  })
})
