import { BYLINE_CHAR_LIMIT } from '../shared/constants'

// Byline blocks Readability misses (#6), most trustworthy first. On transformer-circuits.pub only `div.d-byline-container` is populated while the static `<d-byline>` stays empty; distill.pub is the reverse, so the class selector catches both.
const BYLINE_BLOCK_SELECTORS = ['[class*="byline"]', 'd-byline']

// Last resort: classes that usually mean a byline but may be a sidebar or wrapper; the length cap in normaliseByline rejects wrong matches.
const GENERIC_SELECTORS = [
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
 *
 * Deliberately ignores Readability's own `article.byline`. Its rule is a
 * substring match for `author` on class and id, so on any Wikipedia article with
 * an authority-control box (`class="navbox authority-control"` — "authority"
 * contains "author") it returns "Authority control databases" as the byline.
 * `rel`/`itemprop`/`.author`/`[class*="byline"]` below cover the trustworthy part
 * of that rule; missing a byline beats inventing one.
 */
export function extractByline(doc: Document): string | undefined {
  return pickByline([
    ...BYLINE_BLOCK_SELECTORS.map((selector) => textOf(doc, selector)),
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
  if (UNFILLED_TEMPLATE.test(normalised)) return undefined
  return normalised
}

// Distill's byline template before its script fills it; the content script can run mid-render, and "Not published yet" is worse than no byline.
const UNFILLED_TEMPLATE = /not published yet|no doi yet/i

function textOf(doc: Document, selector: string): string | undefined {
  const element = doc.querySelector(selector)
  if (!element) return undefined
  // innerText, not textContent: it respects display:none and keeps labelled lines apart.
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
