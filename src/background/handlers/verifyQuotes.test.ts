import { describe, expect, it } from 'vitest'
import { MIN_QUOTE_CHARS } from '../../shared/constants'
import { collapseWhitespace, verifyQuotes } from './verifyQuotes'

const page = [
  'Introducing Loomkit 2.0',
  'By Dana Reyes, co-founder. Published March 3, 2026.',
  '',
  'Thanks to the 1,200 beta testers who filed over 3,000 bug reports during the preview.',
].join('\n')

describe('collapseWhitespace', () => {
  it('turns any run of whitespace into one space and trims the ends', () => {
    expect(collapseWhitespace('  a \n\n b\t\tc  ')).toBe('a b c')
  })

  it('counts no-break and narrow no-break spaces as whitespace', () => {
    // Nemotron writes dates like "March 3" with U+202F; a page often has U+00A0.
    expect(collapseWhitespace('March 3, 2026')).toBe('March 3, 2026')
  })
})

describe('verifyQuotes', () => {
  it('verifies a quote that appears in the page text word for word', () => {
    const quote = 'Thanks to the 1,200 beta testers who filed over 3,000 bug reports'
    expect(verifyQuotes(page, [quote])).toEqual({ verified: [quote], errors: [] })
  })

  it('ignores line breaks and spacing differences on the page side', () => {
    const wrapped = 'The launch is\n   rolling out   to all\nworkspaces over the next two weeks.'
    expect(verifyQuotes(wrapped, ['rolling out to all workspaces']).verified).toEqual(['rolling out to all workspaces'])
  })

  it('ignores spacing differences on the quote side, and stores the collapsed form', () => {
    const result = verifyQuotes(page, ['By Dana Reyes,\n  co-founder.'])
    expect(result.verified).toEqual(['By Dana Reyes, co-founder.'])
  })

  it('matches a model quote written with a narrow no-break space against a plain-spaced page', () => {
    expect(verifyQuotes(page, ['Published March 3, 2026.']).verified).toEqual(['Published March 3, 2026.'])
  })

  it('rejects a quote that is not in the page, and says so in the words the model needs', () => {
    const result = verifyQuotes(page, ['The attack works by asking the model to think step by step'])
    expect(result.verified).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('quote not found in page text')
    expect(result.errors[0]).toContain('The attack works by asking')
  })

  it('does not treat a different case as the same passage', () => {
    expect(verifyQuotes(page, ['by dana reyes, co-founder.']).verified).toEqual([])
  })

  it('rejects two fragments joined with an ellipsis, since the joined text is not on the page', () => {
    const joined = 'Introducing Loomkit 2.0 … Thanks to the 1,200 beta testers'
    expect(verifyQuotes(page, [joined]).verified).toEqual([])
  })

  it('rejects a quote too short to mean anything, even though the page contains it', () => {
    const short = 'Dana'
    expect(short.length).toBeLessThan(MIN_QUOTE_CHARS)
    const result = verifyQuotes(page, [short])
    expect(result.verified).toEqual([])
    expect(result.errors[0]).toContain('quote too short')
  })

  it('accepts a quote of exactly the minimum length and rejects one a character shorter', () => {
    const synthetic = `intro ${'x'.repeat(MIN_QUOTE_CHARS)} outro`
    expect(verifyQuotes(synthetic, ['x'.repeat(MIN_QUOTE_CHARS)]).verified).toHaveLength(1)
    expect(verifyQuotes(synthetic, ['x'.repeat(MIN_QUOTE_CHARS - 1)]).verified).toEqual([])
  })

  it('never verifies a blank quote, which is a substring of every page', () => {
    const result = verifyQuotes(page, ['', '   \n '])
    expect(result.verified).toEqual([])
    expect(result.errors).toHaveLength(2)
  })

  it('counts the length after collapsing, so padding cannot make a short quote long enough', () => {
    const padded = `Dana${' '.repeat(50)}`
    expect(verifyQuotes(page, [padded]).verified).toEqual([])
  })

  it('reports verified and rejected quotes from one call separately', () => {
    const real = 'Thanks to the 1,200 beta testers'
    const invented = 'Loomkit 2.0 adds an AI assistant'
    const result = verifyQuotes(page, [real, invented])
    expect(result.verified).toEqual([real])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain(invented)
  })

  it('lists a repeated quote once', () => {
    const quote = 'Thanks to the 1,200 beta testers'
    expect(verifyQuotes(page, [quote, quote]).verified).toEqual([quote])
  })

  it('clips a very long rejected quote in the error rather than echoing all of it back', () => {
    const long = `Nothing on the page says this. ${'x'.repeat(500)}`
    const [error] = verifyQuotes(page, [long]).errors
    expect(error.length).toBeLessThan(200)
  })

  it('has nothing to report for no quotes', () => {
    expect(verifyQuotes(page, [])).toEqual({ verified: [], errors: [] })
  })
})
