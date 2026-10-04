import type { AnswerSource } from '../shared/types'

const LABELS: Record<AnswerSource, string> = {
  page: 'from the page',
  web: 'from the web',
  'page+web': 'from the page and the web',
  // Says what happened, not a verdict: worded as a warning it read as an accusation (ADR 0005).
  unverified: 'not checked against the page',
}

interface SourceContext {
  /** The page was cut short when this answer was given (#12). */
  truncated?: boolean
}

// A page label shows how many quotes were checked, since one quote doesn't prove every claim (ADR 0005).
export function describeSource(source: AnswerSource, quotes: readonly string[] = [], { truncated }: SourceContext = {}): string {
  if (source === 'unverified' && truncated) return 'not checked · page was cut short'
  const label = LABELS[source]
  const quoted = source === 'page' || source === 'page+web'
  if (!quoted || quotes.length === 0) return label
  return `${label} · ${quotes.length} ${quotes.length === 1 ? 'quote' : 'quotes'} checked`
}

// The sentence behind the chip, for hover: what it does and does not say.
export function explainSource(source: AnswerSource, { truncated, quotes = 0 }: SourceContext & { quotes?: number } = {}): string | undefined {
  if (source === 'unverified') {
    return truncated
      ? "The page was cut short, so this answer can't be checked against the part that wasn't read. It may still be right."
      : 'No quote from the page was found to check this answer against. It may still be right.'
  }
  if ((source === 'page' || source === 'page+web') && quotes > 0) {
    return `The model quoted the page and ${quotes} ${quotes === 1 ? 'quote was' : 'quotes were'} found word for word. That doesn't mean every claim in the answer is on the page.`
  }
  return undefined
}
