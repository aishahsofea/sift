import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StepList } from './StepList'

describe('StepList', () => {
  it('is a collapsed row that counts the steps', () => {
    const html = renderToStaticMarkup(
      <StepList steps={[{ kind: 'scanning', query: 'methods' }, { kind: 'citing', found: 3, total: 3 }]} />,
    )

    expect(html).toContain('<summary>2 steps</summary>')
    expect(html).not.toContain(' open')
  })

  it('lists each step in order, with the quote check counted', () => {
    const html = renderToStaticMarkup(
      <StepList steps={[{ kind: 'scanning', query: 'methods' }, { kind: 'citing', found: 3, total: 3 }]} />,
    )

    expect(html).toContain('<li>Searching this page for “methods”</li>')
    expect(html).toContain('<li>Checking quotes against the page: 3 of 3 found</li>')
    expect(html.indexOf('methods')).toBeLessThan(html.indexOf('3 of 3'))
  })

  it('says "1 step" for a single step', () => {
    const html = renderToStaticMarkup(<StepList steps={[{ kind: 'reading', url: 'https://example.com/pricing' }]} />)

    expect(html).toContain('<summary>1 step</summary>')
  })
})
