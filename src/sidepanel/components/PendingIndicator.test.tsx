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

  it('lists the steps already done above the one running', () => {
    const html = renderToStaticMarkup(
      <PendingIndicator label="Reading example.com/pricing…" done={['Searching example.com for “pricing”']} />,
    )

    expect(html).toContain('<li>Searching example.com for “pricing”</li>')
    expect(html.indexOf('Searching example.com')).toBeLessThan(html.indexOf('Reading example.com/pricing…'))
    expect(html).toContain('Reading example.com/pricing…')
  })

  it('has no list before a first step is done', () => {
    const html = renderToStaticMarkup(<PendingIndicator label="Thinking…" />)

    expect(html).not.toContain('<ol')
  })
})
