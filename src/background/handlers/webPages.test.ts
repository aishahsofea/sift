import { describe, expect, it } from 'vitest'
import { MAX_WEB_PAGES } from '../../shared/constants'
import { buildWebPages } from './webPages'

const a = 'https://loomkit.example/pricing'
const b = 'https://loomkit.example/help/pruning'

describe('buildWebPages', () => {
  it('lists search results as found when nothing was fetched', () => {
    expect(buildWebPages(new Map([[a, 'Pricing']]), [])).toEqual({ read: [], found: [{ title: 'Pricing', url: a }] })
  })

  it('moves a fetched page to read and out of found', () => {
    const pages = buildWebPages(new Map([[a, 'Pricing'], [b, 'Pruning']]), [{ url: a, partial: false }])
    expect(pages.read).toEqual([{ title: 'Pricing', url: a }])
    expect(pages.found).toEqual([{ title: 'Pruning', url: b }])
  })

  it('marks a partly read page', () => {
    expect(buildWebPages(new Map([[a, 'Pricing']]), [{ url: a, partial: true }]).read).toEqual([{ title: 'Pricing', url: a, partial: true }])
  })

  it('dedupes a page fetched twice', () => {
    expect(buildWebPages(new Map([[a, 'Pricing']]), [{ url: a, partial: false }, { url: a, partial: true }]).read).toHaveLength(1)
  })

  it('shows the path when the title is empty', () => {
    expect(buildWebPages(new Map([[b, '  ']]), []).found).toEqual([{ title: '/help/pruning', url: b }])
  })

  it('drops non-http URLs', () => {
    const pages = buildWebPages(new Map([['javascript:alert(1)', 'x'], ['ftp://x.example/a', 'y'], ['not a url', 'z']]), [{ url: 'javascript:alert(1)', partial: false }])
    expect(pages).toEqual({ read: [], found: [] })
  })

  it('caps each list', () => {
    const results = new Map(Array.from({ length: MAX_WEB_PAGES + 5 }, (_, i) => [`https://loomkit.example/${i}`, `Page ${i}`]))
    expect(buildWebPages(results, []).found).toHaveLength(MAX_WEB_PAGES)
  })
})
