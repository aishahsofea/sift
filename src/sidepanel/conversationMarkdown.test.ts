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

  it('exports a question\'s quoted passage as a block before the question', () => {
    const md = buildConversationMarkdown(page, [{ role: 'user', content: 'What does this mean?', selection: 'Billed yearly\n\nCancel any time' }])
    expect(md).toContain('## Question\n\n> Billed yearly\n>\n> Cancel any time\n\nWhat does this mean?')
  })

  it('omits the source line and quotes when an answer has none', () => {
    const md = buildConversationMarkdown(page, [{ role: 'assistant', content: 'Hi' }])
    expect(md).not.toContain('Source:')
    expect(md).not.toContain('Quoted')
  })

  it('lists the web pages read and found as links', () => {
    const md = buildConversationMarkdown(page, [
      {
        role: 'assistant',
        content: 'Pro is $17.50.',
        webPages: {
          read: [{ title: 'Pricing [new]', url: 'https://example.com/pricing', partial: true }],
          found: [{ title: 'FAQ', url: 'https://example.com/faq' }],
        },
      },
    ])
    expect(md).toContain('**Web pages read:**\n\n- [Pricing \\[new\\]](https://example.com/pricing) (partly read)')
    expect(md).toContain('**Also found:**\n\n- [FAQ](https://example.com/faq)')
  })

  it('lists the steps the agent took as a numbered list', () => {
    const md = buildConversationMarkdown(page, [
      {
        role: 'assistant',
        content: 'Pro is $12.',
        steps: [
          { kind: 'searching', domain: 'example.com', query: 'pricing tiers' },
          { kind: 'reading', url: 'https://example.com/pricing' },
          { kind: 'citing', found: 3, total: 3 },
        ],
      },
    ])
    expect(md).toContain(
      '**Steps:**\n\n1. Searching example.com for “pricing tiers”\n2. Reading example.com/pricing\n3. Checking quotes against the page: 3 of 3 found',
    )
  })

  it('has no steps section for an answer without steps', () => {
    expect(buildConversationMarkdown(page, [{ role: 'assistant', content: 'Hi' }])).not.toContain('Steps')
  })

  it('puts an italic stats line after the answer, and none on an old turn without stats', () => {
    const withStats = buildConversationMarkdown(page, [{ role: 'assistant', content: 'Hi', stats: { durationMs: 4200, toolRounds: 1 } }])
    expect(withStats).toContain('Hi\n\n*4.2s · 1 tool round*')
    expect(buildConversationMarkdown(page, [{ role: 'assistant', content: 'Hi' }])).not.toMatch(/\*\d/)
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
