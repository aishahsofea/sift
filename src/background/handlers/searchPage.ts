import { PAGE_SEARCH_CUT_PASSAGES, PAGE_SEARCH_MAX_PASSAGES, PAGE_SEARCH_PASSAGE_CHARS } from '../../shared/constants'

export interface PagePassage {
  /** Where the passage starts in the page text, in characters. */
  offset: number
  text: string
}

// A page is scanned in windows PAGE_SEARCH_PASSAGE_CHARS wide that start half a window
// apart, so every character is in two of them and a sentence on a window's edge is
// whole in its neighbour. Windows rather than paragraphs because the extracted text
// has no dependable paragraph breaks: Readability's textContent runs blocks together
// whenever the source markup has no whitespace between them.
const STRIDE = PAGE_SEARCH_PASSAGE_CHARS / 2

// BM25's term-frequency saturation. Its length normalisation is left out on purpose:
// every window is the same width, so there is nothing to normalise.
const K1 = 1.2

// A passage is moved at most this far to start or end between words. A stretch with no
// whitespace in it (a long URL, a script written without spaces) is cut where it falls.
const SNAP_CHARS = 60

// Letters and digits in any script, so "Life-of-a-Jailbreak" is three words and "12" is one.
// A script written without spaces comes out as one long word and matches only whole.
const WORD = /[\p{L}\p{N}]+/gu

// Just enough stemming that "jailbreaks" finds "jailbreak" and "attacked" finds
// "attack": drop a plural s, then keep six letters. It merges some unrelated words
// ("transformer", "transfer"), which costs a stray passage; a miss costs a round.
const STEM_CHARS = 6

function stem(word: string): string {
  const lower = word.toLowerCase()
  const singular = lower.length > 3 && lower.endsWith('s') && !lower.endsWith('ss') ? lower.slice(0, -1) : lower
  return singular.slice(0, STEM_CHARS)
}

// For a fetched page the head is already in the prompt, so `pastCutOnly` ranks only the
// windows past `cutAt` and `maxPassages` sets how many to return (#27).
export interface SearchPageOptions {
  pastCutOnly?: boolean
  maxPassages?: number
}

// The local half of search_page (#11, ADR 0006): BM25 over the page text, no model, no
// network. Returns up to PAGE_SEARCH_MAX_PASSAGES passages, best first, none of them
// overlapping, each with the character offset it starts at.
//
// It searches the whole page, not only the part the prompt lacks. The model cannot
// reliably find a section in a 40,000-token head (the passage it wants can be sitting in
// the prompt, unfound), and "the page has nothing on this" only means something if the
// whole page was looked through. But the part past `cutAt` is what the tool is for, so it
// is guaranteed PAGE_SEARCH_CUT_PASSAGES slots before rank fills the rest: a head that
// names the word in its table of contents and abstract must not push out the section
// body it summarizes (#5).
//
// For a fetched page the head is already in the prompt, so `pastCutOnly` ranks only the
// windows past `cutAt` and `maxPassages` sets how many to return (#27).
export function searchPage(
  text: string,
  query: string,
  cutAt = text.length,
  { pastCutOnly = false, maxPassages = PAGE_SEARCH_MAX_PASSAGES }: SearchPageOptions = {},
): PagePassage[] {
  const terms = new Set(Array.from(query.matchAll(WORD), (match) => stem(match[0])))
  if (!terms.size) return []

  // How many times each term occurs in each window, by window number. A window w spans
  // [w * STRIDE, (w + 2) * STRIDE), so a word is in the window its position falls in and
  // the one before it.
  const counts = new Map<string, Map<number, number>>()
  for (const match of text.matchAll(WORD)) {
    const term = stem(match[0])
    if (!terms.has(term)) continue
    const inWindows = counts.get(term) ?? new Map<number, number>()
    const slot = Math.floor(match.index / STRIDE)
    for (const window of [slot - 1, slot]) {
      // Only in a window that holds all of the word: one across the window's end would
      // count there and then be cut from the passage shown, which would not have it.
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

// The window's text, moved in to whole words and trimmed. The offset is taken after
// both, so `text.slice(offset, offset + passage.length)` is always the passage. Words
// here are the ones the search counts, so what is cut off is only a word the window
// itself cut in two, which was not counted in it (see the loop above).
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
