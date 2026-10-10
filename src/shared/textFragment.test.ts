import { describe, expect, it } from 'vitest'
import { textFragmentUrl } from './textFragment'

describe('textFragmentUrl', () => {
  it('appends an encoded text directive', () => {
    expect(textFragmentUrl('https://a.com/p', 'hello world')).toBe('https://a.com/p#:~:text=hello%20world')
  })

  it('encodes -, comma and & so they are not read as directive syntax', () => {
    expect(textFragmentUrl('https://a.com/p', 'a-b, c&d')).toBe('https://a.com/p#:~:text=a%2Db%2C%20c%26d')
  })

  it('collapses whitespace and newlines', () => {
    expect(textFragmentUrl('https://a.com/p', ' one\n  two\tthree ')).toBe('https://a.com/p#:~:text=one%20two%20three')
  })

  it('drops an existing hash', () => {
    expect(textFragmentUrl('https://a.com/p?q=1#section', 'hi')).toBe('https://a.com/p?q=1#:~:text=hi')
  })

  it('uses the start,end form for a long quote', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`)
    const url = textFragmentUrl('https://a.com/p', words.join(' '))
    expect(url).toBe(
      'https://a.com/p#:~:text=word0%20word1%20word2%20word3%20word4,word55%20word56%20word57%20word58%20word59',
    )
  })

  it('keeps a short quote whole', () => {
    const url = textFragmentUrl('https://a.com/p', 'x '.repeat(50).trim())
    expect(url).not.toContain(',')
  })
})
