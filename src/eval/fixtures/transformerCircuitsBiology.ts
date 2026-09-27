import rawContent from './transformerCircuitsBiology.txt?raw'
import { TRUNCATION_CHAR_LIMIT } from '../../shared/constants'
import { truncate } from '../../shared/truncate'
import type { ExtractedPage } from '../../shared/types'

// Captured 2026-09-27 by injecting the exact @mozilla/readability version pinned in
// package.json (0.6.0) into the live page and running the same extraction as
// src/content/index.ts:22-25 (isProbablyReaderable + Readability on a cloned
// document, .textContent.trim()) — not curl+strip, which ADR 0006 found puts the
// jailbreak section on the wrong side of the cut in a different copy of this page.
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

// #5's own question (issue #3, comment 2): the paper's jailbreak analysis, and the
// "keeps going" mechanism that was #5's partly-grounded half.
export const truncatedTailQuestion =
  "What jailbreak does the paper study, and why does the model keep going after it starts complying?"

// Answerable from well within the head (§4, "Planning in Poems") and unrelated to the
// jailbreak section, so there is no reason to search and no excuse to abstain.
export const falseAbstentionQuestion =
  'When Claude 3.5 Haiku writes a line of a poem, does it improvise word by word or plan the rhyme in advance?'

// The real mechanism has several genuine facets, verified directly against the captured
// text (grep transformerCircuitsBiology.txt to re-check any of these):
//   - The specific mechanics (§10.2-10.4, past the cut): the prompt is an acrostic
//     ("Babies Outlive Mustard Block" -> "BOMB"); the model stitches the word together
//     letter by letter with no semantic understanding, so it has "no opportunity to
//     recognize the harmful request" until it has already said it. It only gets a chance
//     to refuse once a "new sentence" boundary lets refusal features outweigh the
//     "grammatically valid"/inductive momentum that was carrying the completion forward
//     (§10.1 Figure 42 caption, §10.3, §10.4's "no strong pathways along which the model
//     considers refusing").
//   - A general-level description of the *same* finding, verified present well within the
//     head at char ~19,815 ("Related to Jailbreaks"): "an obfuscated input that prevents a
//     model from refusing immediately... the model fails to form a representation of the
//     harmful request until it is too late."
//   - The abstract's own one-sentence gloss, verified within the head at char ~4,614: the
//     attack works by tricking the model into complying "without realizing it," after
//     which it continues "due to pressure to adhere to syntactic and grammatical rules."
// A first version of this regex only matched the first bullet and wrongly flagged 10 of 15
// genuinely-grounded live answers that faithfully used the second or third (verified via
// npm run test:eval, then re-checked against the raw fixture with grep before widening this).
// The syntactic/grammatical branch is deliberately loose (no required suffix): the model
// paraphrases with synonyms ("flow", "consistency", "structure" for "rules"), and this
// specific vocabulary is a distinctive fingerprint of this paper's own framing that a
// generic wrong guess has no reason to reach for.
export const REAL_MECHANISM_RE =
  /acrostic|Babies\s+Outlive\s+Mustard\s+Block|first\s+letters?\s+of\s+each\s+word|spell(?:s|ing|ed)?\s+out|letter[\s-]by[\s-]letter|piec(?:es|ing)?\s+together\s+the\s+letters?|stitch(?:es|ing)?\s+together|doesn['’]?t\s+know\s+what\s+it\s+(?:plans\s+to\s+say|is\s+about\s+to\s+say|is\s+saying)|no\s+opportunity\s+to\s+recogni[sz]e|obfuscat(?:ed|ion)|fails?\s+to\s+form\s+a\s+representation|new\s+sentence|sentence\s+(?:boundary|termination|-final)|grammatically\s+(?:in)?valid|considers?\s+refusing|no\s+strong\s+pathways|syntactic|grammatical|pressure\s+to\s+adhere/i

// Reference only — NOT used as a live per-run gate (see the content check in
// truncatedTailGrounding.eval.ts). The historical shape of the #5-style failure (ADR
// 0005: the answer "inverted the defining detail of the attack"): the paper's finding is
// that the model has "no opportunity to recognize the harmful request" until after it has
// already spelled out "BOMB" — the inversion claims the opposite, that it recognizes the
// request up front and keeps going anyway. A regex built from this shape
// (`recognizes...harmful...continues`) was tried live and is negation-blind: "it does
// **not** recognize... bomb... keeps generating" — a real, correct, negated statement of
// the true finding — matched it anyway, because the pattern never checks for the "not" in
// between. It also false-triggered on "completing the chain of thought it has started," an
// idiom for "its in-progress response," not a claim that the attack manipulates
// chain-of-thought reasoning. Both were caught live (npm run test:eval, 2026-09-27) and are
// why the shipped gate checks *for* REAL_MECHANISM_RE rather than *against* this: matching
// the specific, verified real shape is far more reliable than enumerating every wrong one.
// Kept here as documentation of the failure shape, and as the source of the fabricated
// string used in the mutation test (step 11) that proves the shipped gate can fail.
export const WRONG_MECHANISM_RE =
  /\b(?:recogni[sz]es|realizes|knows|understands)\b[^.?!]{0,100}\b(?:harmful|dangerous|bomb|weapon)\b[^.?!]{0,80}\b(?:continues?|proceeds?|complies?|keeps?\s+going|goes?\s+on)\b|chain[\s-]of[\s-]thought|role-?play|hypothetical\s+(?:scenario|framing)|pretend(?:ing|s)?\s+(?:it['’]?s|to\s+be)|\bDAN\b|think\s+step\s+by\s+step/i

// An honest "the page doesn't cover this" — never actually observed on this question in
// live runs (the paper does cover it), but a genuinely honest abstention shouldn't be
// penalized for not matching REAL_MECHANISM_RE just because it correctly declined to
// invent something.
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

// Synchronous, no-API-call check that this copy still reproduces #5's shape: the real
// mechanism past the cut, the abstract-only summary within it, and a false-abstention
// topic within it too. Run this before spending any real API calls (step 8 of the plan).
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
