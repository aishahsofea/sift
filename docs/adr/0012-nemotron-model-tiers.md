# 12. Nano is the default; Ultra is opt-in

- Status: accepted
- Date: 2026-10-10
- Related: [ADR 0002](0002-nemotron-nano-as-agent-model.md), [ADR 0007](0007-grounding-eval-set.md), [#70](https://github.com/aishahsofea/sift/issues/70)

## Context

The Nemotron model family has tiers: Nano for fast everyday calls, Super in the
middle, Ultra (`nvidia/Nemotron-3-Ultra-550b-a55b`, on this account) for harder
reasoning. Sift used Nano only. #70 asked whether to escalate to Ultra on hard
turns (a page too long for the prompt, repeated `cite_page` rejections), measured
against the grounding eval, with "no" as an acceptable answer.

## Decision

- Nano stays the default for every turn (ADR 0002).
- Ultra is a user choice: an options-page checkbox that makes every turn use it.
  If the account lacks Ultra, the turn falls back to the Nano/Super order.
- There is no automatic escalation. The setting is ignored on the shared demo
  proxy, whose daily caps are sized for Nano and which a single Ultra user could
  burn through.

## Verification

Live, 2026-10-10, the truncated-tail case on the real #5 page, which exercises
`search_page`, `cite_page` and the quote-first nudge. The gate counts a run as a
failure if it labels an answer `page` without the real mechanism, or gives a
confident answer without it.

| | Nano | Ultra |
|---|---|---|
| Runs passing the gate | 3 of 3 | 4 of 6 |

Both Ultra failures were labelled `unverified`, so the label was honest, but the
answer was useless: one printed its own chain of thought as the answer, the other
said it saw no question after the quote-first nudge. Nano had neither.

Limits: 3 and 6 runs can't separate a real difference from noise; the per-run
latency, token counts and cost of passing runs weren't captured; the fetch
case was not run. The data supports "Ultra showed no gain here", not "Ultra
cannot help".

## Consequences

- Automatic escalation is rejected: no measured gain, and a mid-turn model switch
  loses the prefix cache ADR 0002 measured on Nano (21,120 of 23,454 prompt tokens).
- Opting in is a per-install, whole-turn choice, so it never switches mid-turn.
- Revisit if Ultra's failures turn out to be a prompt issue: both failed runs
  were answers written after the quote-first nudge, which was tuned on Nano.
- The trace records `citeRejections` per run, which a later escalation trigger
  would need.
