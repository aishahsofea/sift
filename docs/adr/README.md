# Architecture decision records

One file per decision, in Nygard's format: context, decision, consequences,
plus a **Verification** section whenever the decision rests on something
checked live against the real Nebius/Tavily APIs rather than on documentation.

Product decisions that were settled before this folder existed stay in
[PLAN.md](../../PLAN.md). ADRs take over from there: when a decision changes
the architecture, contradicts a locked PLAN.md row, or would otherwise be
re-litigated in three weeks, write one here and mark what it supersedes.

Numbering is sequential. Status is `proposed`, `accepted` or `superseded by
ADR NNNN` — edit the status of the old record instead of deleting it.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-model-driven-agent-loop.md) | Model-driven agent loop replaces the two-pass page/web pipeline | accepted |
| [0002](0002-nemotron-nano-as-agent-model.md) | Nemotron 3 Nano stays the model behind the loop | accepted |
| [0003](0003-forcing-the-final-answer.md) | End the loop by dropping the tools and nudging, not with `tool_choice: "none"` | accepted |
| [0004](0004-fetch-page-url-allowlist.md) | `fetch_page` only accepts URLs a search returned | accepted |
| [0005](0005-grounding-is-verified-not-assumed.md) | Grounding is verified, not inferred from the absence of a tool call | accepted |
| [0006](0006-long-pages-are-kept-and-searched-locally.md) | Long pages are kept whole and searched locally, not truncated | proposed |
| [0007](0007-grounding-eval-set.md) | The grounding eval set | accepted |
