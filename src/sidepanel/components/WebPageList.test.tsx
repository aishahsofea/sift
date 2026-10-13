import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WebPage } from '../../shared/types'
import { WebPageList } from './WebPageList'

const page = (n: number, extra: Partial<WebPage> = {}): WebPage => ({ title: `Page ${n}`, url: `https://loomkit.example/docs/${n}`, ...extra })

describe('WebPageList', () => {
  it('is a collapsed row that counts the pages', () => {
    const html = renderToStaticMarkup(<WebPageList pages={{ read: [page(1)], found: [page(2)] }} />)

    expect(html).toContain('<summary>2 web pages</summary>')
    expect(html).not.toContain('<details open')
  })

  it('lists read pages before found ones, with the path and no domain', () => {
    const html = renderToStaticMarkup(<WebPageList pages={{ read: [page(1)], found: [page(2)] }} />)

    expect(html.indexOf('Read')).toBeLessThan(html.indexOf('Also found'))
    expect(html).toContain('/docs/1')
    expect(html).not.toContain('>loomkit.example')
  })

  it('opens links in a new tab without handing over the opener', () => {
    const html = renderToStaticMarkup(<WebPageList pages={{ read: [page(1)], found: [] }} />)

    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('tags a partly read page', () => {
    const html = renderToStaticMarkup(<WebPageList pages={{ read: [page(1, { partial: true })], found: [] }} />)

    expect(html).toContain('partly read')
  })

  it('collapses found pages past three', () => {
    const found = [1, 2, 3, 4, 5].map((n) => page(n))
    const html = renderToStaticMarkup(<WebPageList pages={{ read: [], found }} />)

    expect(html).toContain('<summary>2 more</summary>')
    expect(html).not.toContain('<h4>Read</h4>')
  })
})
