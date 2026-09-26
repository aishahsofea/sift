import { BYLINE_CHAR_LIMIT } from '../shared/constants'

// Byline blocks Readability doesn't return. Ordered most trustworthy first:
// whichever candidate normalises to something usable wins, so a precise match
// beats a lucky one.
//
// The Distill selectors come first because that layout is the reason this exists
// (#6): on transformer-circuits.pub and distill.pub the author block sits outside
// <d-article>, so Readability never sees it — and the block carries more than
// names (affiliations, publication date, and the `† Lead Contributor` legend that
// says which name means what).
const DISTILL_SELECTORS = ['d-byline', '.d-byline']

// Last resort: class names that usually mean a byline but sometimes mean a
// sidebar or a page wrapper. The length cap in normaliseByline is what keeps a
// wrong match out of the prompt.
const GENERIC_SELECTORS = [
  '[class*="byline"]',
  '[itemprop="author"]',
  '[rel="author"]',
  '.authors',
  '.author',
  'address',
]

// `article:author` and friends arrive as `property`, the rest as `name`.
const META_NAMES = ['author', 'article:author', 'dc.creator', 'parsely-author', 'twitter:creator']

/**
 * The page's byline, or undefined when the page has none worth sending.
 *
 * Reads the live document, not Readability's clone — .parse() mutates what it's
 * given, so the clone is no longer a faithful copy by the time it returns.
 */
export function extractByline(doc: Document, readabilityByline?: string | null): string | undefined {
  return pickByline([
    ...DISTILL_SELECTORS.map((selector) => textOf(doc, selector)),
    readabilityByline,
    ...metaBylines(doc),
    ...GENERIC_SELECTORS.map((selector) => textOf(doc, selector)),
  ])
}

/** The first candidate that normalises to a usable byline. */
export function pickByline(candidates: (string | null | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    const normalised = normaliseByline(candidate)
    if (normalised) return normalised
  }
  return undefined
}

/**
 * Collapses a raw byline to compact lines, or rejects it.
 *
 * Rejection is the point of the length cap: a selector like `.author` can match a
 * whole page wrapper, and a truncated wrapper is worse than no byline at all.
 * Line structure survives because a Distill block is several labelled lines
 * (AUTHORS / AFFILIATIONS / PUBLISHED / footnote legend), not one sentence.
 */
export function normaliseByline(raw: string | null | undefined, limit: number = BYLINE_CHAR_LIMIT): string | undefined {
  if (!raw) return undefined

  const normalised = raw
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')

  if (normalised.length < 2 || normalised.length > limit) return undefined
  return normalised
}

function textOf(doc: Document, selector: string): string | undefined {
  const element = doc.querySelector(selector)
  if (!element) return undefined
  // innerText, not textContent: it respects display:none and renders block
  // boundaries as newlines, which is what keeps the labelled lines apart.
  return (element as HTMLElement).innerText ?? element.textContent ?? undefined
}

function metaBylines(doc: Document): (string | undefined)[] {
  // citation_author repeats once per author, so all of them together are the byline.
  const citation = [...doc.querySelectorAll<HTMLMetaElement>('meta[name="citation_author"]')]
    .map((meta) => meta.content.trim())
    .filter(Boolean)

  return [
    citation.length ? citation.join(', ') : undefined,
    ...META_NAMES.map(
      (name) =>
        doc.querySelector<HTMLMetaElement>(`meta[name="${name}"], meta[property="${name}"]`)?.content ?? undefined,
    ),
  ]
}
