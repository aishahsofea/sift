import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PendingIndicator } from './PendingIndicator'

describe('PendingIndicator', () => {
  it('puts the status text in a role=status region', () => {
    const html = renderToStaticMarkup(<PendingIndicator label="Thinking…" />)

    expect(html).toContain('role="status"')
    expect(html).toContain('Thinking…')
  })

  it('hides the animated dots from assistive tech', () => {
    const html = renderToStaticMarkup(<PendingIndicator label="Thinking…" />)

    expect(html).toContain('aria-hidden="true"')
  })

  it('is not styled as a finished assistant bubble', () => {
    const html = renderToStaticMarkup(<PendingIndicator label="Thinking…" />)

    expect(html).not.toContain('message-bubble-assistant')
  })
})
