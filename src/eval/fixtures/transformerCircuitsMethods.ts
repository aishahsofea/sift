import rawContent from './transformerCircuitsMethods.txt?raw'

// Captured like transformerCircuitsBiology.txt (ADR 0007): pinned Readability stands in for fetch_page.
export const METHODS_URL = 'https://transformer-circuits.pub/2025/attribution-graphs/methods.html'
export const METHODS_FULL_TEXT = rawContent

// Issue #7's question, verbatim. The biology page reads as covering it, so no escalation (ADR 0009).
export const pruningQuestion =
  'In the companion methods paper, how do they decide which nodes to prune out of an attribution graph?'

// The same ask phrased for what only the methods paper has; "exact thresholds" gets the model to search_site.
export const thresholdsQuestion =
  'What exact thresholds does the companion methods paper use when pruning nodes and edges from an attribution graph?'

// Shaped like #7's search_site snippet: names the paper, no numbers. Hand-written, not a Tavily capture.
export const pruningSnippet =
  'Methods for constructing and analyzing attribution graphs, including the local replacement model, attribution computation, and graph pruning.'

// Appendix F's thresholds (#7): node 0.8, edge 0.98, logit 0.95, past both char limits (ADR 0007).
export const NODE_THRESHOLD_RE = /\b0\.8\b|\b80\s?%/
export const EDGE_THRESHOLD_RE = /\b0\.98\b|\b98\s?%/
export const LOGIT_THRESHOLD_RE = /\b0\.95\b|\b95\s?%/

// Synchronous, no-API check that this copy has the real algorithm where expected.
export function assertFixtureIntegrity(): void {
  const appendixIdx = METHODS_FULL_TEXT.indexOf('Graph Pruning', 200_000)
  if (appendixIdx < 0) {
    throw new Error('Fixture integrity: the Appendix F "Graph Pruning" heading was not found past char 200,000. Recapture the fixture.')
  }
  // The exact sentences, not the gate regexes, which also accept "80%" from an unrelated sentence.
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
