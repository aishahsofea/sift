import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SharedThread } from './SharedThread'
import { SharedThreadBanner } from './SharedThreadBanner'

const snapshot = {
  pageUrl: 'https://a.com/p',
  pairs: [{ question: 'Who wrote it?', answer: 'Dana Reyes.', source: 'page' as const, quotes: ['Dana Reyes wrote it'] }],
}

describe('SharedThreadBanner', () => {
  it('says the thread is a read-only share and offers a way out', () => {
    const html = renderToStaticMarkup(<SharedThreadBanner questions={2} onDismiss={() => {}} />)
    expect(html).toContain('Shared thread, read-only (2 questions)')
    expect(html).toContain('Start my own thread')
  })

  it('uses the singular for one question', () => {
    expect(renderToStaticMarkup(<SharedThreadBanner questions={1} onDismiss={() => {}} />)).toContain('(1 question)')
  })
})

describe('SharedThread', () => {
  const connect = vi.fn()
  const sendMessage = vi.fn()
  vi.stubGlobal('chrome', { runtime: { connect, sendMessage } })

  const html = renderToStaticMarkup(<SharedThread snapshot={snapshot} tabId={3} onDismiss={() => {}} />)

  it('shows the thread and its quotes', () => {
    expect(html).toContain('Who wrote it?')
    expect(html).toContain('Dana Reyes.')
    expect(html).toContain('1 quote')
  })

  it('has no composer, edit or regenerate control', () => {
    expect(html).not.toContain('chat-input')
    expect(html).not.toContain('Edit message')
    expect(html).not.toContain('Regenerate answer')
  })

  it('opens no ask port and sends no message', () => {
    expect(connect).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
