# 2. Nemotron 3 Nano stays the model behind the loop

- Status: accepted
- Date: 2026-09-25
- Related: [ADR 0001](0001-model-driven-agent-loop.md)

## Context

The agent loop asks more of the model than the old two-pass pipeline did:
choose a tool, write its arguments, read results, decide whether to search
again. Nemotron 3 Nano is a 30B model with ~3B active parameters, so the
obvious worry was that multi-step tool use would be flaky and that a larger
model would be needed.

This account exposes four Nemotron models:
`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `nvidia/Nemotron-3_5-Lightning`,
`nvidia/nemotron-3-super-120b-a12b`, `nvidia/Nemotron-3-Ultra-550b-a55b`.
Nebius positions Super as the tool-calling/multi-agent tier, which made it the
natural candidate to switch to.

## Decision

Stay on Nano for the agent loop. Keep resolving the ID from `GET /v1/models`
rather than hardcoding it, as
[modelDiscovery.ts](../../src/background/nebius/modelDiscovery.ts) already does.

## Verification

Same spike, same day (2026-09-23), both models, identical cases:

| | Nano | Super |
|---|---|---|
| Checks passed | 73/73 | 73/73 |
| Prompt tokens cached (~100K-char page) | 21,120 of 23,454 | 0 |
| Both rounds on that page | 1.5s + 1.9s | 2.6s + 4.6s |
| Tool discipline | called only what it needed | fetched a page whose snippet already held the answer, and hit the round cap |
| Query style | `Dana Reyes` | `author:"Dana Reyes" site:loomkit.example` |

Super is correct but slower, chattier with tools, and gets no prefix caching on
this account. Its search operators are also actively unhelpful for us: `site:`
duplicates the `include_domains` scoping, and Tavily treats the operator as
query text, which was already shown in Phase 4 to cost relevance.

## Consequences

- The "re-send the page every round" design in
  [ADR 0001](0001-model-driven-agent-loop.md) leans on prefix caching, which is
  a **Nano-specific observation**. Any model switch has to re-measure it.
- If Super is ever adopted, the `search_site` description needs an explicit
  "plain keywords, no search operators" instruction, and the round cap should
  be re-tuned for its extra tool calls.
- Re-run `npm run test:tools <model-id>` before any switch; the comparison above
  is exactly what it prints.
- Unrelated but adjacent: 4 of the 5 IDs in `NEMOTRON_CANDIDATES` no longer
  exist on this account, so the candidate list is doing almost no work. Only
  Nano matches; everything else falls through to "first Nemotron in the list".
