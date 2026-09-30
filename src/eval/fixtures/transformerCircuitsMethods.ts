import rawContent from './transformerCircuitsMethods.txt?raw'

// Captured 2026-09-28 the same way ADR 0007 captured transformerCircuitsBiology.txt:
// injecting the exact @mozilla/readability version pinned in package.json (0.6.0) into
// the live page and running the same extraction as src/content/index.ts:21-27
// (isProbablyReaderable + Readability on a cloned document, .textContent.trim()), not
// curl+strip. This stands in for what fetch_page's extractTavily would return for this
// URL: Tavily has its own extraction, not Readability's, but what this eval needs is
// real page text with the real thresholds at their real position, not a byte-for-byte
// match to Tavily's own scraper.
export const METHODS_URL = 'https://transformer-circuits.pub/2025/attribution-graphs/methods.html'
export const METHODS_FULL_TEXT = rawContent

// Issue #7's own question, verbatim.
//
// It does not reach the escalation path on the biology page, and not because of anything
// this record's fix touches: that page's own text says "we prune them to their most
// important components by removing nodes and edges that do not contribute significantly to
// the model's output", so the model judges the tab page to cover the question, cites that
// real sentence and never searches (measured 2026-09-28 with the shipped prompt and the
// page retained, as in the incident: 1 of 29 samples called search_site, 15 full eval runs
// and 14 round-1 probes; its reasoning reads "the companion methods paper" as this page's
// methods section). Naming "a different page or document ... such as a companion or linked
// paper" in the prompt's site-search trigger did not move it (1 of 8 either way).
// SEARCH_NOTE and FETCH_NOTE_CUT only appear after a search, so they cannot help. Kept as
// a telemetry-only case, not a gate: an open gap in how the model judges
// whether a page covers a question (ADR 0005's "one verified quote is a floor, not
// proof"), tracked in ADR 0009 rather than fixed by it.
export const pruningQuestion =
  'In the companion methods paper, how do they decide which nodes to prune out of an attribution graph?'

// The same ask, phrased for what only the methods paper has. The tab page has no
// thresholds to quote, and asking for "exact thresholds" is what makes the model reach for
// search_site (measured 2026-09-28, round-1 probes on the biology page: 3 of 4 search_site,
// the other search_page("prune"); the alternatives tried, "Look up Appendix F..." and
// "(not this page)", were 2 of 4 each). Its answer is the same three numbers as #7's own
// "Done when", so the gate below is unchanged.
export const thresholdsQuestion =
  'What exact thresholds does the companion methods paper use when pruning nodes and edges from an attribution graph?'

// Shaped like the real search_site snippet in #7: names the paper, gives no numbers.
// Not a captured live Tavily snippet (search_site is mocked below, and #7 doesn't quote
// the real one) — a hand-written stand-in of the same thin shape.
export const pruningSnippet =
  'Methods for constructing and analyzing attribution graphs, including the local replacement model, attribution computation, and graph pruning.'

// The real Appendix F thresholds (issue #7's own "Done when"), verified directly against
// the captured text (grep transformerCircuitsMethods.txt to re-check any of these): node
// pruning sorts by cumulative influence and cuts at 0.8 ("We use a threshold of 0.8
// unless otherwise noted"), edge pruning re-scores and cuts at a higher 0.98 ("using a
// higher cutoff 0.98 unless otherwise noted"), and logit nodes are kept until their total
// probability exceeds 0.95 ("is greater than 0.95"). All three sit together at char
// ~230,500-231,300 of 303,698 — comfortably past both FETCHED_PAGE_CHAR_LIMIT (20,000,
// where fetch_page's own result is cut) and TRUNCATION_CHAR_LIMIT (120,000).
//
// Either notation counts, because the paper uses both for the same three facts: the
// appendix's own summary says "~80% of the influence on the logits ... ~98% of the
// remaining influence", and "95% of the probability mass" is in the main text. The
// first version of this gate took only the decimals and scored a complete, correct live
// answer ("cumulative influence ... 0.8", "0.98", "exceeds 95 %") as 2 of 3 — a false
// negative, found by reading the raw failure before believing it (ADR 0007). Still exact,
// checkable numbers with no shape-guessing; the word boundaries only keep "0.85" or
// "180%" from matching. "0.98"/"98%" occur only in Appendix F, so a match on the edge
// threshold means the model got there. "0.8" and "0.95" also appear glued into the §5.3
// sensitivity table ("Link0.950.87236..."), which is why requiring all three matters. The
// biology page (the tab page) has the same numerals too, in unrelated probability tables
// ("Austin 98%", "0.8%"), so one match is not proof of retrieval; all three together is
// what makes an accident negligible.
export const NODE_THRESHOLD_RE = /\b0\.8\b|\b80\s?%/
export const EDGE_THRESHOLD_RE = /\b0\.98\b|\b98\s?%/
export const LOGIT_THRESHOLD_RE = /\b0\.95\b|\b95\s?%/

// Synchronous, no-API-call check that this copy still has the real algorithm where
// expected, the way transformerCircuitsBiology.ts's assertFixtureIntegrity does for its
// own fixture. Run this before spending any real API calls.
export function assertFixtureIntegrity(): void {
  const appendixIdx = METHODS_FULL_TEXT.indexOf('Graph Pruning', 200_000)
  if (appendixIdx < 0) {
    throw new Error('Fixture integrity: the Appendix F "Graph Pruning" heading was not found past char 200,000. Recapture the fixture.')
  }
  // The exact sentences, not the gate regexes: those also accept "80%", which occurs in
  // an unrelated sentence at char ~18,000.
  for (const sentence of ['We use a threshold of 0.8', 'higher cutoff 0.98', 'is greater than 0.95']) {
    const idx = METHODS_FULL_TEXT.indexOf(sentence)
    if (idx < 200_000) {
      throw new Error(`Fixture integrity: "${sentence}" expected in Appendix F past char 200,000 (found at ${idx}). Recapture the fixture.`)
    }
  }
  if (!METHODS_FULL_TEXT.includes('Embedding nodes and error nodes are not pruned')) {
    throw new Error('Fixture integrity: expected the "not pruned" exemption sentence near the thresholds.')
  }
}
