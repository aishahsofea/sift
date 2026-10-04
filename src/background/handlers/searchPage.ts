import { PAGE_SEARCH_CUT_PASSAGES, PAGE_SEARCH_MAX_PASSAGES, PAGE_SEARCH_PASSAGE_CHARS } from '../../shared/constants'

export interface PagePassage {
  /** Where the passage starts in the page text, in characters. */
  offset: number
  text: string
}

// Half-window stride so a sentence on one window's edge is whole in its neighbour; windows, not paragraphs, since Readability runs blocks together.
const STRIDE = PAGE_SEARCH_PASSAGE_CHARS / 2

// BM25 term-frequency saturation; length normalisation is omitted because every window is the same width.
const K1 = 1.2

// A window edge moves at most this far to land between words; whitespace-free stretches are cut where they fall.
const SNAP_CHARS = 60

// Letters and digits in any script; a script written without spaces becomes one long word and matches only whole.
const WORD = /[\p{L}\p{N}]+/gu

// Minimal stemming ("jailbreaks" finds "jailbreak"): drop a plural s, keep six letters. A stray passage is cheaper than a miss.
const STEM_CHARS = 6

function stem(word: string): string {
  const lower = word.toLowerCase()
  const singular = lower.length > 3 && lower.endsWith('s') && !lower.endsWith('ss') ? lower.slice(0, -1) : lower
  return singular.slice(0, STEM_CHARS)
}

// For a fetched page the head is already in the prompt, so `pastCutOnly` ranks only windows past `cutAt` (#27).
export interface SearchPageOptions {
  pastCutOnly?: boolean
  maxPassages?: number
}

// Local BM25 half of search_page (#11, ADR 0006), best first, non-overlapping. Searches the whole page, but PAGE_SEARCH_CUT_PASSAGES slots go to the part past `cutAt` so the head can't crowd it out (#5).
export function searchPage(
  text: string,
  query: string,
  cutAt = text.length,
  { pastCutOnly = false, maxPassages = PAGE_SEARCH_MAX_PASSAGES }: SearchPageOptions = {},
): PagePassage[] {
  const terms = new Set(Array.from(query.matchAll(WORD), (match) => stem(match[0])))
  if (!terms.size) return []

  // Term counts per window number; window w spans [w * STRIDE, (w + 2) * STRIDE).
  const counts = new Map<string, Map<number, number>>()
  for (const match of text.matchAll(WORD)) {
    const term = stem(match[0])
    if (!terms.has(term)) continue
    const inWindows = counts.get(term) ?? new Map<number, number>()
    const slot = Math.floor(match.index / STRIDE)
    for (const window of [slot - 1, slot]) {
      // Only count words wholly inside the window, since a word across its end is cut from the shown passage.
      if (window >= 0 && match.index + match[0].length <= (window + 2) * STRIDE) {
        inWindows.set(window, (inWindows.get(window) ?? 0) + 1)
      }
    }
    counts.set(term, inWindows)
  }

  const windowCount = Math.ceil(text.length / STRIDE)
  const scores = new Map<number, number>()
  for (const inWindows of counts.values()) {
    const idf = Math.log(1 + (windowCount - inWindows.size + 0.5) / (inWindows.size + 0.5))
    for (const [window, count] of inWindows) {
      scores.set(window, (scores.get(window) ?? 0) + (idf * count * (K1 + 1)) / (count + K1))
    }
  }

  // Best score first; equal scores fall to the earlier window, so the result is the same every time.
  const byScore = (a: number, b: number) => scores.get(b)! - scores.get(a)! || a - b
  // A window is in the cut-off part when its middle is. A page that wasn't cut has none.
  const pastCut = (window: number) => (window + 1) * STRIDE >= cutAt
  const ranked = [...scores.keys()].filter((window) => !pastCutOnly || (cutAt < text.length && pastCut(window))).sort(byScore)

  const chosen: number[] = []
  const take = (windows: number[], upTo: number) => {
    for (const window of windows) {
      if (chosen.length >= upTo) return
      // Windows a step apart overlap by half, so a window next to a chosen one is a second view of the same text.
      if (chosen.some((taken) => Math.abs(taken - window) < 2)) continue
      chosen.push(window)
    }
  }
  if (!pastCutOnly && cutAt < text.length) take(ranked.filter(pastCut), PAGE_SEARCH_CUT_PASSAGES)
  take(ranked, maxPassages)

  return chosen.sort(byScore).map((window) => passage(text, window * STRIDE, (window + 2) * STRIDE))
}

// Trimmed to whole words before the offset is taken, so `text.slice(offset, offset + passage.length)` is always the passage.
function passage(text: string, windowStart: number, windowEnd: number): PagePassage {
  let start = windowStart
  let end = Math.min(windowEnd, text.length)

  if (start > 0 && isWordChar(text[start - 1]) && isWordChar(text[start])) {
    const boundary = firstWhere(text, start, Math.min(start + SNAP_CHARS, end), (char) => !isWordChar(char))
    if (boundary !== -1) start = boundary
  }
  if (end < text.length && isWordChar(text[end - 1]) && isWordChar(text[end])) {
    const boundary = lastWhere(text, end - 1, Math.max(end - SNAP_CHARS, start), (char) => !isWordChar(char))
    if (boundary !== -1) end = boundary
  }

  const raw = text.slice(start, end)
  return { offset: start + (raw.length - raw.trimStart().length), text: raw.trim() }
}

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char)

function firstWhere(text: string, from: number, to: number, test: (char: string) => boolean): number {
  for (let i = from; i < to; i++) if (test(text[i])) return i
  return -1
}

function lastWhere(text: string, from: number, to: number, test: (char: string) => boolean): number {
  for (let i = from; i >= to; i--) if (test(text[i])) return i
  return -1
}
