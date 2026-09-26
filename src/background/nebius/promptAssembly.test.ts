import { describe, expect, it } from 'vitest'
import type { ChatTurn, ExtractedPage } from '../../shared/types'
import { assembleAgentMessages, pageText } from './promptAssembly'

const page: ExtractedPage = {
  url: 'https://example.com/article',
  title: 'Example Article',
  content: 'The launch date is March 3rd.',
  extractionMethod: 'readability',
  truncated: false,
  charsOmitted: 0,
}

const withSearch = { searchEnabled: true, citeEnabled: true }
const withoutSearch = { searchEnabled: false, citeEnabled: true }

describe('assembleAgentMessages', () => {
  it('puts a system message with the page title, URL, and content first', () => {
    const [system] = assembleAgentMessages(page, [], 'When does it launch?', withSearch)
    expect(system.role).toBe('system')
    expect(system.content).toContain(page.title)
    expect(system.content).toContain(page.url)
    expect(system.content).toContain(page.content)
  })

  it('includes the byline when the page has one', () => {
    const withByline: ExtractedPage = { ...page, byline: 'AUTHORS\nJack Lindsey†\n† Lead Contributor' }
    const [system] = assembleAgentMessages(withByline, [], 'Who is the lead contributor?', withSearch)
    expect(system.content).toContain('Jack Lindsey†')
    expect(system.content).toContain('† Lead Contributor')
  })

  it('says nothing about a byline when the page has none', () => {
    const [system] = assembleAgentMessages(page, [], 'Who wrote this?', withSearch)
    expect(system.content).not.toContain('byline')
  })

  it('scopes the prompt to the page hostname', () => {
    const [system] = assembleAgentMessages(page, [], 'When does it launch?', withSearch)
    expect(system.content).toContain('example.com')
  })

  it('names both tools when search is available', () => {
    const [system] = assembleAgentMessages(page, [], 'When does it launch?', withSearch)
    expect(system.content).toContain('search_site')
    expect(system.content).toContain('fetch_page')
  })

  it('promises no search when no Tavily key is configured', () => {
    const [system] = assembleAgentMessages(page, [], 'When does it launch?', withoutSearch)
    expect(system.content).not.toContain('search_site')
    expect(system.content).toContain('no search available')
  })

  it('keeps the page in the prompt regardless of search, so page and web can combine', () => {
    const [enabled] = assembleAgentMessages(page, [], 'q', withSearch)
    const [disabled] = assembleAgentMessages(page, [], 'q', withoutSearch)
    expect(enabled.content).toContain(page.content)
    expect(disabled.content).toContain(page.content)
  })

  describe('citation (ADR 0005)', () => {
    it('tells the model to call cite_page before answering from the page, with passages copied word for word', () => {
      const [system] = assembleAgentMessages(page, [], 'q', withSearch)
      expect(system.content).toContain('call cite_page')
      expect(system.content).toContain('copied word for word')
      expect(system.content.indexOf('cite_page')).toBeLessThan(system.content.indexOf('Page content:'))
    })

    it('asks for a few short passages, since long ones get edited when copied', () => {
      const [withBoth] = assembleAgentMessages(page, [], 'q', withSearch)
      const [noSearch] = assembleAgentMessages(page, [], 'q', withoutSearch)
      for (const system of [withBoth, noSearch]) {
        expect(system.content).toContain('up to three short passages (a sentence or less each)')
      }
    })

    it('asks for citations whether or not search is available, since it needs no network', () => {
      const [system] = assembleAgentMessages(page, [], 'q', withoutSearch)
      expect(system.content).toContain('call cite_page')
    })

    it('gives search and the page their own path, and keeps cite_page off the search one', () => {
      const [system] = assembleAgentMessages(page, [], 'q', withSearch)
      const [pagePath, sitePath] = system.content.split('\n').filter((line) => /^[12]\. /.test(line))
      expect(pagePath).toContain('From the page content')
      expect(pagePath).toContain('call cite_page')
      expect(sitePath).toContain('From the site')
      expect(sitePath).toContain('call search_site')
      expect(sitePath).toContain('call fetch_page')
      expect(sitePath).toContain("Don't call cite_page on this path")
    })

    it('says only that the page cannot be answered from with no search, when there is no search', () => {
      const [system] = assembleAgentMessages(page, [], 'q', withoutSearch)
      expect(system.content).not.toContain('two ways')
      expect(system.content).toContain('no search available')
    })

    it('says nothing about cite_page when it is not offered, and keeps the single-path wording', () => {
      const [system] = assembleAgentMessages(page, [], 'q', { searchEnabled: true, citeEnabled: false })
      expect(system.content).not.toContain('cite_page')
      expect(system.content).not.toContain('two ways')
      expect(system.content).toContain('Answer from the page content below whenever it covers the question.')
    })

    it('is identical from one question to the next, so the cached prefix survives', () => {
      const [first] = assembleAgentMessages(page, [], 'first question', withSearch)
      const [second] = assembleAgentMessages(page, [], 'second question', withSearch)
      expect(second.content).toBe(first.content)
    })
  })

  describe('pageText', () => {
    const withByline: ExtractedPage = { ...page, byline: 'AUTHORS\nJack Lindsey†' }

    it('is what the prompt presents as the page: title, byline and content', () => {
      const text = pageText(withByline)
      expect(text).toContain(withByline.title)
      expect(text).toContain('Jack Lindsey†')
      expect(text).toContain(withByline.content)
    })

    it('leaves out the URL, which is metadata rather than page text', () => {
      expect(pageText(withByline)).not.toContain(withByline.url)
    })

    it('has nothing extra for a page with no byline', () => {
      expect(pageText(page)).toBe(`${page.title}\n${page.content}`)
    })
  })

  describe('when the page was truncated', () => {
    const truncatedPage: ExtractedPage = { ...page, truncated: true, charsOmitted: 126_323 }

    it('names how many characters were cut and says the later sections are missing', () => {
      const [system] = assembleAgentMessages(truncatedPage, [], 'What is the jailbreak attack?', withSearch)
      expect(system.content).toContain('cut off')
      expect(system.content).toContain('126,323 characters')
      expect(system.content).toContain('every section after the cut is missing')
    })

    it('says a section the content only names or summarizes is still missing', () => {
      const [system] = assembleAgentMessages(truncatedPage, [], 'q', withSearch)
      expect(system.content).toContain('names or summarizes')
      expect(system.content).toContain('a summary is not the section')
    })

    it('points at search as the way to reach the missing part when search is available', () => {
      const [system] = assembleAgentMessages(truncatedPage, [], 'q', withSearch)
      expect(system.content).toContain('call search_site for it')
    })

    it('tells the model to say the page was cut off when search is not available', () => {
      const [system] = assembleAgentMessages(truncatedPage, [], 'q', withoutSearch)
      expect(system.content).toContain('say the page was cut off')
      expect(system.content).not.toContain('search_site')
    })

    it('puts the notice before the page content, and leaves the content itself untouched', () => {
      const [system] = assembleAgentMessages(truncatedPage, [], 'q', withSearch)
      expect(system.content.indexOf('cut off')).toBeLessThan(system.content.indexOf('Page content:'))
      expect(system.content).toContain(truncatedPage.content)
    })

    it('is identical from one question to the next, so the cached prefix survives', () => {
      const [first] = assembleAgentMessages(truncatedPage, [], 'first question', withSearch)
      const [second] = assembleAgentMessages(truncatedPage, [], 'second question', withSearch)
      expect(second.content).toBe(first.content)
    })
  })

  it('says nothing about truncation when the page is whole', () => {
    const [system] = assembleAgentMessages(page, [], 'q', withSearch)
    expect(system.content).not.toContain('cut off')
    expect(system.content).not.toContain('characters')
  })

  it('appends the new question as the final user message', () => {
    const messages = assembleAgentMessages(page, [], 'When does it launch?', withSearch)
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'When does it launch?' })
  })

  it('preserves prior history in order between the system prompt and the new question', () => {
    const history: ChatTurn[] = [
      { role: 'user', content: 'What is this page about?' },
      { role: 'assistant', content: 'A product launch.', source: 'page' },
    ]
    const messages = assembleAgentMessages(page, history, 'When does it launch?', withSearch)

    expect(messages).toEqual([
      { role: 'system', content: expect.any(String) },
      { role: 'user', content: 'What is this page about?' },
      { role: 'assistant', content: 'A product launch.' },
      { role: 'user', content: 'When does it launch?' },
    ])
  })

  it('drops the source field from history turns since the API only accepts role/content', () => {
    const history: ChatTurn[] = [{ role: 'assistant', content: 'A product launch.', source: 'web' }]
    const messages = assembleAgentMessages(page, history, 'When?', withSearch)
    expect(messages[1]).not.toHaveProperty('source')
  })

  it('drops the verified quotes from history turns too', () => {
    const history: ChatTurn[] = [
      { role: 'assistant', content: 'A product launch.', source: 'page', quotes: ['The launch date is March 3rd.'] },
    ]
    const messages = assembleAgentMessages(page, history, 'When?', withSearch)
    expect(messages[1]).toEqual({ role: 'assistant', content: 'A product launch.' })
  })

  it('drops the truncation fields from history turns too', () => {
    const history: ChatTurn[] = [
      { role: 'assistant', content: 'A product launch.', source: 'unverified', truncated: true, charsOmitted: 126_323 },
    ]
    const messages = assembleAgentMessages(page, history, 'When?', withSearch)
    expect(messages[1]).toEqual({ role: 'assistant', content: 'A product launch.' })
  })
})
