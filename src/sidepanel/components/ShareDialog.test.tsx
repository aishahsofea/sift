import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ShareLink } from '../../shared/shareSnapshot'
import { ShareDialog } from './ShareDialog'

const render = (result: ShareLink | null) => renderToStaticMarkup(<ShareDialog result={result} onCopy={() => {}} onCancel={() => {}} />)
const link = 'https://x/#u=a&d=b'

describe('ShareDialog', () => {
  it('offers to copy, with the privacy note, when everything fits', () => {
    const html = render({ link, sharedPairs: 2, droppedPairs: 0 })
    expect(html).toContain('Shares 2 questions')
    expect(html).toContain('no server stores it')
    expect(html).toContain('Copy link')
  })

  it('says how many turns were dropped, and still asks before copying', () => {
    const html = render({ link, sharedPairs: 2, droppedPairs: 3 })
    expect(html).toContain('last 2 of 5 questions')
    expect(html).toContain('Copy link')
    expect(html).toContain('Cancel')
  })

  it('offers no copy when nothing fits', () => {
    const html = render({ link: null, sharedPairs: 0, droppedPairs: 1 })
    expect(html).toContain('too long')
    expect(html).not.toContain('Copy link')
    expect(html).not.toContain('no server stores it')
  })

  it('offers no copy for an empty thread', () => {
    expect(render({ link: null, sharedPairs: 0, droppedPairs: 0 })).not.toContain('Copy link')
  })

  it('offers no copy while building', () => {
    const html = render(null)
    expect(html).toContain('Building the link')
    expect(html).not.toContain('Copy link')
  })

  it('confirms the copy and drops the button', () => {
    const html = renderToStaticMarkup(
      <ShareDialog result={{ link, sharedPairs: 1, droppedPairs: 0 }} copied onCopy={() => {}} onCancel={() => {}} />,
    )
    expect(html).toContain('Link copied.')
    expect(html).not.toContain('Copy link')
  })
})
