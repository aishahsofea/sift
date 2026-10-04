import rawContent from './transformerCircuitsBiology.txt?raw'
import { TRUNCATION_CHAR_LIMIT } from '../../shared/constants'
import { truncate } from '../../shared/truncate'
import type { ExtractedPage } from '../../shared/types'

// Captured 2026-09-27 by running the pinned @mozilla/readability (0.6.0) on the live page as src/content/index.ts does, not curl+strip, which puts the jailbreak section on the wrong side of the cut (ADR 0006).
export const FULL_TEXT = rawContent

const { content: HEAD, truncated, charsOmitted } = truncate(FULL_TEXT, TRUNCATION_CHAR_LIMIT)

export const page: ExtractedPage = {
  url: 'https://transformer-circuits.pub/2025/attribution-graphs/biology.html',
  title: 'On the Biology of a Large Language Model',
  content: HEAD,
  extractionMethod: 'readability',
  truncated,
  charsOmitted,
  searchable: true,
}

// #5's own question (issue #3): the jailbreak analysis and its "keeps going" mechanism.
export const truncatedTailQuestion =
  "What jailbreak does the paper study, and why does the model keep going after it starts complying?"

// Answerable well within the head (§4) and unrelated to the jailbreak section, so no reason to search or abstain.
export const falseAbstentionQuestion =
  'When Claude 3.5 Haiku writes a line of a poem, does it improvise word by word or plan the rhyme in advance?'

// The real mechanism has three facets, verified against the captured text: the acrostic mechanics past the cut (§10.2-10.4); the general description in the head ("Related to Jailbreaks", char ~19,815); and the abstract's gloss (char ~4,614). A first version matched only the first and flagged 10 of 15 grounded answers. The syntactic/grammatical branch is loose on purpose, since the model paraphrases.
export const REAL_MECHANISM_RE =
  /acrostic|Babies\s+Outlive\s+Mustard\s+Block|first\s+letters?\s+of\s+each\s+word|spell(?:s|ing|ed)?\s+out|letter[\s-]by[\s-]letter|piec(?:es|ing)?\s+together\s+the\s+letters?|stitch(?:es|ing)?\s+together|doesn['’]?t\s+know\s+what\s+it\s+(?:plans\s+to\s+say|is\s+about\s+to\s+say|is\s+saying)|no\s+opportunity\s+to\s+recogni[sz]e|obfuscat(?:ed|ion)|fails?\s+to\s+form\s+a\s+representation|new\s+sentence|sentence\s+(?:boundary|termination|-final)|grammatically\s+(?:in)?valid|considers?\s+refusing|no\s+strong\s+pathways|syntactic|grammatical|pressure\s+to\s+adhere/i

// Reference only, not a live gate: the #5-style inversion ("recognizes the request and keeps going"). A regex of this shape was negation-blind and false-triggered on an idiom (live 2026-09-27), so the gate checks for REAL_MECHANISM_RE instead. Kept as the failure shape and the mutation test's fabricated string.
export const WRONG_MECHANISM_RE =
  /\b(?:recogni[sz]es|realizes|knows|understands)\b[^.?!]{0,100}\b(?:harmful|dangerous|bomb|weapon)\b[^.?!]{0,80}\b(?:continues?|proceeds?|complies?|keeps?\s+going|goes?\s+on)\b|chain[\s-]of[\s-]thought|role-?play|hypothetical\s+(?:scenario|framing)|pretend(?:ing|s)?\s+(?:it['’]?s|to\s+be)|\bDAN\b|think\s+step\s+by\s+step/i

// An honest "the page doesn't cover this"; never seen live, but shouldn't be penalized for not matching REAL_MECHANISM_RE.
export const ABSTENTION_RE =
  /doesn['’]?t\s+(?:say|mention|cover|specify|address)|could\s?n['’]?t\s+find|no\s+(?:specific\s+)?information|not\s+(?:mentioned|covered|specified|addressed)|the\s+page\s+(?:doesn['’]?t|does\s+not)/i

function indexOfOccurrence(haystack: string, needle: string, occurrence: number): number {
  let idx = -1
  for (let i = 0; i < occurrence; i++) {
    idx = haystack.indexOf(needle, idx + 1)
    if (idx === -1) return -1
  }
  return idx
}

// Synchronous, no-API check that this copy reproduces #5's shape: mechanism past the cut, abstract-only summary and a false-abstention topic within it.
export function assertFixtureIntegrity(): void {
  const jailbreakSectionIdx = FULL_TEXT.indexOf('Life of a Jailbreak')
  if (jailbreakSectionIdx < 0) {
    throw new Error('Fixture integrity: "Life of a Jailbreak" section heading not found in the captured page.')
  }
  if (jailbreakSectionIdx <= TRUNCATION_CHAR_LIMIT) {
    throw new Error(
      `Fixture integrity: the jailbreak section now starts at ${jailbreakSectionIdx}, not past TRUNCATION_CHAR_LIMIT ` +
        `(${TRUNCATION_CHAR_LIMIT}). This copy no longer reproduces #5's shape — recapture the fixture.`,
    )
  }

  const abstractIdx = FULL_TEXT.indexOf('An Analysis of a Jailbreak')
  if (abstractIdx < 0 || abstractIdx >= TRUNCATION_CHAR_LIMIT) {
    throw new Error(
      'Fixture integrity: expected the abstract\'s "An Analysis of a Jailbreak" summary to be within the head ' +
        `(found at ${abstractIdx}). Without it the partly-grounded case has nothing for the model to half-ground in.`,
    )
  }

  const planningIdx = indexOfOccurrence(FULL_TEXT, 'Planning in Poems', 2)
  if (planningIdx < 0 || planningIdx >= TRUNCATION_CHAR_LIMIT) {
    throw new Error(
      `Fixture integrity: expected the "Planning in Poems" section body within the head (found at ${planningIdx}). ` +
        'The false-abstention question depends on it being answerable with no search.',
    )
  }

  if (!truncated) {
    throw new Error('Fixture integrity: expected the captured page to be longer than TRUNCATION_CHAR_LIMIT.')
  }
}
