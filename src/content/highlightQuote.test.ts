// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { highlightQuote } from './highlightQuote'

// jsdom has no Custom Highlight API or scrollIntoView.
const highlights = new Map<string, { ranges: Range[] }>()
const scrollIntoView = vi.fn()

beforeEach(() => {
  highlights.clear()
  scrollIntoView.mockClear()
  vi.stubGlobal('CSS', { highlights })
  vi.stubGlobal('Highlight', class { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges } })
  Element.prototype.scrollIntoView = scrollIntoView
})

function setBody(html: string) {
  document.body.innerHTML = html
}

const highlighted = () => highlights.get('sift-quote')?.ranges.map(String)

describe('highlightQuote', () => {
  it('highlights a quote inside one text node and scrolls to it', () => {
    setBody('<p>Thanks to the 1,200 beta testers who filed bug reports.</p>')

    expect(highlightQuote('the 1,200 beta testers')).toBe(true)

    expect(highlighted()).toEqual(['the 1,200 beta testers'])
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('highlights a quote that spans several elements', () => {
    setBody('<p>Thanks to the <b>1,200</b> beta <a href="#">testers</a> who filed bug reports.</p>')

    expect(highlightQuote('the 1,200 beta testers who')).toBe(true)

    expect(highlighted()).toEqual(['the 1,200 beta testers who'])
  })

  it('matches across newlines and runs of whitespace in the page', () => {
    setBody('<p>Thanks to the\n   1,200  beta\ntesters.</p>')

    expect(highlightQuote('the 1,200 beta testers')).toBe(true)
  })

  it('matches a quote that crosses blocks with no whitespace between them', () => {
    setBody('<h2>Results</h2><p>There were 1,200 testers.</p>')

    expect(highlightQuote('ResultsThere were 1,200')).toBe(true)
  })

  it('matches a quote that crosses blocks the way innerText joins them', () => {
    setBody('<h2>Results</h2><p>There were 1,200 testers.</p>')

    expect(highlightQuote('Results There were 1,200')).toBe(true)
  })

  it('is case-sensitive, like the check that verified the quote', () => {
    setBody('<p>Thanks to the 1,200 beta testers.</p>')

    expect(highlightQuote('THE 1,200 BETA TESTERS')).toBe(false)
  })

  it('returns false and highlights nothing when the quote is not on the page', () => {
    setBody('<p>Thanks to the beta testers.</p>')

    expect(highlightQuote('a quote that is not here')).toBe(false)
    expect(highlights.size).toBe(0)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('returns false for a blank quote', () => {
    setBody('<p>Some text</p>')

    expect(highlightQuote('   ')).toBe(false)
  })

  it('ignores script and style text', () => {
    setBody('<style>.a { color: red }</style><script>var quote = "the secret"</script><p>Nothing here.</p>')

    expect(highlightQuote('color: red')).toBe(false)
    expect(highlightQuote('the secret')).toBe(false)
  })

  it('moves the highlight when called again', () => {
    setBody('<p>First passage here.</p><p>Second passage here.</p>')

    highlightQuote('First passage')
    highlightQuote('Second passage')

    expect(highlighted()).toEqual(['Second passage'])
  })

  it('keeps the earlier highlight when a later quote is not found', () => {
    setBody('<p>First passage here.</p>')

    highlightQuote('First passage')
    highlightQuote('nowhere to be found')

    expect(highlighted()).toEqual(['First passage'])
  })

  it('highlights the first of two matches', () => {
    setBody('<p>beta testers</p><p>more beta testers</p>')

    highlightQuote('beta testers')

    expect(highlights.get('sift-quote')?.ranges[0].startContainer.parentElement?.textContent).toBe('beta testers')
  })
})
