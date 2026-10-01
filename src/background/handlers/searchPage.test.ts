import { describe, expect, it } from 'vitest'
import { PAGE_SEARCH_MAX_PASSAGES, PAGE_SEARCH_PASSAGE_CHARS } from '../../shared/constants'
import { searchPage } from './searchPage'

// At least `chars` characters of whole words that share nothing with any query below, so
// where a term lands is the only thing that decides the ranking.
function filler(chars: number, seed = 'lorem ipsum dolor sit amet'): string {
  const words = seed.split(' ')
  let text = ''
  for (let i = 0; text.length < chars; i++) text += (i ? ' ' : '') + words[i % words.length]
  return text
}

// `padding` characters of filler, then `text`, then filler again: puts `text` at a known offset.
const pageWith = (text: string, padding: number, after = 5_000) => `${filler(padding)} ${text} ${filler(after)}`

describe('searchPage', () => {
  it('finds a passage by a word in it, and says where it starts', () => {
    const page = pageWith('The jailbreak attack tricks the model into starting a dangerous answer.', 40_000)

    const [top] = searchPage(page, 'jailbreak')

    expect(top.text).toContain('jailbreak attack tricks the model into starting a dangerous answer.')
    expect(page.slice(top.offset, top.offset + top.text.length)).toBe(top.text)
    expect(top.offset).toBeGreaterThan(40_000 - PAGE_SEARCH_PASSAGE_CHARS)
    expect(top.offset).toBeLessThan(40_000 + 100)
  })

  it('returns nothing when no word of the query is on the page', () => {
    expect(searchPage(filler(20_000), 'jailbreak')).toEqual([])
  })

  it('returns nothing for a query with no words in it', () => {
    expect(searchPage(pageWith('jailbreak', 1_000), '  ?! ')).toEqual([])
  })

  it('returns nothing for an empty page', () => {
    expect(searchPage('', 'jailbreak')).toEqual([])
  })

  it('ranks the passage that uses the word most first', () => {
    const once = 'One line mentions the jailbreak in passing.'
    const often = 'jailbreak works because the jailbreak starts the answer before the model can refuse the jailbreak.'
    const page = [filler(30_000), once, filler(30_000), `The ${often}`, filler(30_000)].join(' ')

    const results = searchPage(page, 'jailbreak')

    expect(results[0].text).toContain(often)
    expect(results.some((r) => r.text.includes(once))).toBe(true)
    expect(results.findIndex((r) => r.text.includes(often))).toBeLessThan(results.findIndex((r) => r.text.includes(once)))
  })

  it('weighs a rare word above a common one', () => {
    // "model" is on every stretch of the page; "refusal" is in one place.
    const common = `${filler(2_000, 'the model answers')} `
    const page = `${common.repeat(30)}The refusal fires late. ${common.repeat(30)}`

    const [top] = searchPage(page, 'model refusal')

    expect(top.text).toContain('The refusal fires late.')
  })

  it('matches without regard to case', () => {
    const page = pageWith('JAILBREAK results are in Table 4.', 10_000)
    expect(searchPage(page, 'Jailbreak')[0].text).toContain('JAILBREAK results')
  })

  it('finds a plural by its singular and the other way round', () => {
    const page = pageWith('These jailbreaks share one structure.', 10_000)
    expect(searchPage(page, 'jailbreak')[0].text).toContain('These jailbreaks share one structure.')

    const singular = pageWith('The jailbreak has one structure.', 10_000)
    expect(searchPage(singular, 'jailbreaks')[0].text).toContain('The jailbreak has one structure.')
  })

  it('finds an inflected form by its stem', () => {
    const page = pageWith('The attacker attacked twice, attacking the same layer.', 10_000)
    expect(searchPage(page, 'attack')[0].text).toContain('attacker attacked twice, attacking the same layer.')
  })

  it('does not run words together across punctuation', () => {
    const page = pageWith('(see Life-of-a-Jailbreak, above)', 10_000)
    expect(searchPage(page, 'jailbreak')[0].text).toContain('Life-of-a-Jailbreak')
  })

  it('treats a number as a word', () => {
    const page = pageWith('Figure 12 shows the attribution graph.', 10_000)
    expect(searchPage(page, '12')[0].text).toContain('Figure 12')
  })

  it('finds text in scripts other than Latin', () => {
    const page = pageWith('Джейлбрейк обходит защиту модели.', 10_000)
    expect(searchPage(page, 'джейлбрейк')[0].text).toContain('Джейлбрейк обходит')
  })

  it('returns at most the passage cap, none of them overlapping, best first', () => {
    // One hit every 3,000 characters over 60,000: far more matching passages than the cap allows.
    const hit = 'jailbreak'
    const page = Array.from({ length: 20 }, () => `${filler(3_000)} ${hit}`).join(' ')

    const results = searchPage(page, hit)

    expect(results).toHaveLength(PAGE_SEARCH_MAX_PASSAGES)
    const spans = results.map((r) => [r.offset, r.offset + r.text.length] as const).sort((a, b) => a[0] - b[0])
    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1])
  })

  it('does not return two windows of the same hot spot', () => {
    const page = pageWith('jailbreak jailbreak jailbreak jailbreak', 30_000, 30_000)
    const spans = searchPage(page, 'jailbreak').map((r) => [r.offset, r.offset + r.text.length])
    // The four words sit within a few dozen characters; one passage holds all of them.
    expect(spans.filter(([start, end]) => start <= 30_010 && end >= 30_010)).toHaveLength(1)
  })

  it('keeps each passage to about the window size', () => {
    const page = Array.from({ length: 10 }, () => `${filler(5_000)} jailbreak`).join(' ')
    for (const { text } of searchPage(page, 'jailbreak')) {
      expect(text.length).toBeLessThanOrEqual(PAGE_SEARCH_PASSAGE_CHARS)
    }
  })

  it('does not start or end a passage in the middle of a word', () => {
    const page = Array.from({ length: 10 }, () => `${filler(5_000)} jailbreak`).join(' ')
    for (const { text } of searchPage(page, 'jailbreak')) {
      expect(text).toBe(text.trim())
      expect(text).toMatch(/^(lorem|ipsum|dolor|sit|amet|jailbreak)/)
      expect(text).toMatch(/(lorem|ipsum|dolor|sit|amet|jailbreak)$/)
    }
  })

  it('reports an offset that indexes the passage in the page, whatever is snapped or trimmed', () => {
    const page = Array.from({ length: 12 }, (_, i) => `${filler(4_321 + i)}\n\n  jailbreak  `).join(' ')
    for (const { offset, text } of searchPage(page, 'jailbreak')) {
      expect(page.slice(offset, offset + text.length)).toBe(text)
    }
  })

  it('is deterministic: equal scores fall to the earlier passage', () => {
    const page = Array.from({ length: 6 }, () => `${filler(6_000)} jailbreak`).join(' ')
    const first = searchPage(page, 'jailbreak')
    expect(searchPage(page, 'jailbreak')).toEqual(first)
    const offsets = first.map((r) => r.offset)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
  })

  it('never returns a passage without the word it matched, wherever the word falls against a window edge', () => {
    // Windows start every 750 characters: sweep the word across one whole stride, bare and in punctuation.
    for (let shift = 0; shift < 1_500; shift += 7) {
      for (const written of ['jailbreak', '(jailbreak)', 'Life-of-a-Jailbreak']) {
        const page = `${' '.repeat(shift)}${written}${' '.repeat(3_000)}`
        const results = searchPage(page, 'jailbreak')
        expect(results.length).toBeGreaterThan(0)
        for (const { text } of results) expect(text.toLowerCase()).toContain('jailbreak')
      }
    }
  })

  describe('with a cut-off part', () => {
    it('searches the whole page, so a passage in the part the prompt holds is found too', () => {
      const page = `${pageWith('The jailbreak in the summary.', 5_000, 5_000)} ${filler(20_000)}`
      const [top] = searchPage(page, 'jailbreak', 12_000)
      expect(top.text).toContain('jailbreak in the summary.')
    })

    it('holds slots for the part past the cut, so a head that says the word more often cannot hide it', () => {
      const head = Array.from({ length: 12 }, () => `${filler(1_600)} jailbreak jailbreak jailbreak jailbreak`).join(' ')
      const page = `${head} ${filler(20_000)} The jailbreak body starts here. ${filler(3_000)}`

      const uncut = searchPage(page, 'jailbreak')
      const cut = searchPage(page, 'jailbreak', head.length)

      expect(uncut.some((r) => r.text.includes('The jailbreak body starts here.'))).toBe(false)
      expect(cut.some((r) => r.text.includes('The jailbreak body starts here.'))).toBe(true)
      expect(cut.length).toBeLessThanOrEqual(PAGE_SEARCH_MAX_PASSAGES)
    })

    it('returns nothing when the word is nowhere on the page, cut or not', () => {
      expect(searchPage(filler(20_000), 'jailbreak', 10_000)).toEqual([])
    })
  })

  it('is quick on a page at the retention limit', () => {
    const page = Array.from({ length: 4_000 }, (_, i) => `Paragraph ${i}: ${filler(240)}`).join('\n') + ' jailbreak'
    const started = performance.now()
    const [top] = searchPage(page, 'jailbreak')
    expect(top.text).toContain('jailbreak')
    // Generous: it runs in tens of milliseconds. This only catches an accidental O(n^2).
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  describe('pastCutOnly and maxPassages', () => {
    const cutAt = 20_000
    // "jailbreak" in the head, then in six places spread past the cut.
    const spread = [filler(cutAt - 2_000), 'jailbreak in the head']
    for (let i = 0; i < 6; i++) spread.push(filler(8_000), `jailbreak section ${i}`)
    const page = spread.join(' ')

    it('keeps the defaults when no options are given', () => {
      expect(searchPage(page, 'jailbreak', cutAt)).toHaveLength(PAGE_SEARCH_MAX_PASSAGES)
    })

    it('leaves out a match in the head', () => {
      const results = searchPage(page, 'jailbreak', cutAt, { pastCutOnly: true, maxPassages: 8 })

      expect(results.length).toBeGreaterThan(0)
      expect(results.some((r) => r.text.includes('in the head'))).toBe(false)
    })

    it('caps the result at maxPassages', () => {
      expect(searchPage(page, 'jailbreak', cutAt, { pastCutOnly: true, maxPassages: 6 })).toHaveLength(6)
      expect(searchPage(page, 'jailbreak', cutAt, { pastCutOnly: true, maxPassages: 2 })).toHaveLength(2)
    })

    it('returns passages that do not overlap and say where they start', () => {
      const results = searchPage(page, 'jailbreak', cutAt, { pastCutOnly: true, maxPassages: 6 })
      const byOffset = [...results].sort((a, b) => a.offset - b.offset)

      for (const r of results) expect(page.slice(r.offset, r.offset + r.text.length)).toBe(r.text)
      for (let i = 1; i < byOffset.length; i++) {
        expect(byOffset[i].offset).toBeGreaterThanOrEqual(byOffset[i - 1].offset + byOffset[i - 1].text.length)
      }
    })

    it('returns nothing when the page was not cut', () => {
      expect(searchPage(page, 'jailbreak', page.length, { pastCutOnly: true })).toEqual([])
    })
  })
})
