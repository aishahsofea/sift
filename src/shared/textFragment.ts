const LONG_QUOTE_CHARS = 200
const EDGE_WORDS = 5

// encodeURIComponent leaves "-" alone, but it is the prefix/suffix marker in a text directive.
const encode = (text: string) => encodeURIComponent(text).replaceAll('-', '%2D')

export function textFragmentUrl(pageUrl: string, quote: string): string {
  const words = quote.trim().split(/\s+/)
  const text = words.join(' ')
  const directive =
    text.length > LONG_QUOTE_CHARS && words.length > EDGE_WORDS * 2
      ? `${encode(words.slice(0, EDGE_WORDS).join(' '))},${encode(words.slice(-EDGE_WORDS).join(' '))}`
      : encode(text)
  return `${pageUrl.split('#')[0]}#:~:text=${directive}`
}
