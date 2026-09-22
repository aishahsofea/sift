import { describe, expect, it } from 'vitest'
import type { ChatTurn, ExtractedPage } from '../../shared/types'
import { assemblePageGroundedMessages } from './promptAssembly'

const page: ExtractedPage = {
  url: 'https://example.com/article',
  title: 'Example Article',
  content: 'The launch date is March 3rd.',
  extractionMethod: 'readability',
  truncated: false,
}

describe('assemblePageGroundedMessages', () => {
  it('puts a system message with the page title, URL, and content first', () => {
    const [system] = assemblePageGroundedMessages(page, [], 'When does it launch?')
    expect(system.role).toBe('system')
    expect(system.content).toContain(page.title)
    expect(system.content).toContain(page.url)
    expect(system.content).toContain(page.content)
  })

  it('appends the new question as the final user message', () => {
    const messages = assemblePageGroundedMessages(page, [], 'When does it launch?')
    const last = messages[messages.length - 1]
    expect(last).toEqual({ role: 'user', content: 'When does it launch?' })
  })

  it('preserves prior history in order between the system prompt and the new question', () => {
    const history: ChatTurn[] = [
      { role: 'user', content: 'What is this page about?' },
      { role: 'assistant', content: 'A product launch.', source: 'page' },
    ]
    const messages = assemblePageGroundedMessages(page, history, 'When does it launch?')

    expect(messages).toEqual([
      { role: 'system', content: expect.any(String) },
      { role: 'user', content: 'What is this page about?' },
      { role: 'assistant', content: 'A product launch.' },
      { role: 'user', content: 'When does it launch?' },
    ])
  })

  it('drops the source field from history turns since the API only accepts role/content', () => {
    const history: ChatTurn[] = [{ role: 'assistant', content: 'A product launch.', source: 'web' }]
    const messages = assemblePageGroundedMessages(page, history, 'When?')
    expect(messages[1]).not.toHaveProperty('source')
  })
})
