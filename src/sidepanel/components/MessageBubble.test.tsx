import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatTurn } from '../../shared/types'
import { MessageBubble } from './MessageBubble'

function render(turn: ChatTurn): string {
  return renderToStaticMarkup(<MessageBubble turn={turn} />)
}

describe('MessageBubble', () => {
  it('renders a GFM table as a table, not a paragraph', () => {
    const table = ['| Model | Latency |', '| --- | --- |', '| Nemotron | 6s |'].join('\n')

    const html = render({ role: 'assistant', content: table })

    expect(html).toContain('<table>')
    expect(html).toContain('Latency')
    expect(html).not.toMatch(/<p>\s*\|/)
  })

  it('wraps the table so a wide one can scroll inside the bubble instead of the panel', () => {
    const table = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n')

    const html = render({ role: 'assistant', content: table })

    expect(html).toContain('message-bubble-table-wrap')
  })

  it('renders GFM strikethrough', () => {
    const html = render({ role: 'assistant', content: '~~old price~~ new price' })

    expect(html).toContain('<del>old price</del>')
  })

  it('renders a GFM task list', () => {
    const html = render({ role: 'assistant', content: '- [x] done\n- [ ] todo' })

    expect(html).toContain('type="checkbox"')
  })

  it('renders a bare URL as a link', () => {
    const html = render({ role: 'assistant', content: 'see https://example.com for more' })

    expect(html).toContain('<a href="https://example.com"')
  })
})
