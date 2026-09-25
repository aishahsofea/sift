# 1. Model-driven agent loop replaces the two-pass page/web pipeline

- Status: accepted
- Date: 2026-09-25
- Supersedes: the "Fallback trigger" and "Streaming" rows of the locked
  decision table in [PLAN.md](../../PLAN.md)
- Related: [ADR 0002](0002-nemotron-nano-as-agent-model.md),
  [ADR 0003](0003-forcing-the-final-answer.md),
  [ADR 0004](0004-fetch-page-url-allowlist.md)

## Context

Phases 3 and 4 shipped a two-pass pipeline where **our code** decides when to
search: [askQuestion.ts](../../src/background/handlers/askQuestion.ts) asks
Nemotron for a strict-schema `{found_in_page, answer}`,
[useChat.ts](../../src/sidepanel/hooks/useChat.ts) branches on the boolean, and
[tavilyFallback.ts](../../src/background/handlers/tavilyFallback.ts) runs a
second, streamed call over a port.

Three problems, all present in the shipped code:

1. **Follow-ups reach Tavily verbatim.** The raw user question is the search
   query ([tavily/client.ts:28](../../src/background/tavily/client.ts:28)), so
   "what about the second one?" is searched as written. The `(pageTitle)`
   suffix added in Phase 4 patches relevance, not the missing referent.
2. **The fallback pass throws the page away.**
   [promptAssembly.ts:48](../../src/background/nebius/promptAssembly.ts:48)
   builds the second prompt from search results only (it takes `page` but uses
   just the hostname), so a question needing page *and* web can't be answered.
3. **The binary gate can't express "partly on the page."** The model either
   claims the page answers it, or the answer it drafted is discarded.

A single model-driven loop addresses all three, and matches how NVIDIA
positions the Nemotron 3 family (tool calling, long-horizon planning). Queries
the model writes itself are also a more interesting use of Tavily than one
fixed call.

## Decision

One background handler runs a loop. The model gets two native tools and
decides, per turn, whether to call them:

- `search_site(query)` — Tavily search. **Only `query` comes from the model**;
  the domain is pinned in code via `include_domains`, as it is today.
- `fetch_page(url)` — Tavily `/extract` on a search result, for when the
  snippet isn't enough. URLs are allowlisted per [ADR 0004](0004-fetch-page-url-allowlist.md).

Rules the implementation follows:

- The extracted page stays at the **start of the system prompt on every round**,
  so the prefix stays stable and cacheable, and so page + web can be combined.
- Cap at 3 tool rounds, then force an answer as in [ADR 0003](0003-forcing-the-final-answer.md).
- `response_format: json_schema` and `found_in_page` disappear from the chat
  path. The final answer is prose, streamed.
- The "from the page" / "from the web" label is derived from the tool calls
  that actually happened, never from a claim in the model's output.
- Everything moves onto the long-lived port; the one-shot `ASK_QUESTION`
  request/response path goes away. Step events ("searching X for Y") both drive
  the UI and reset the MV3 service-worker idle timer during slow tool calls.

## Verification

`npm run test:tools` ([scripts/test-nebius-tools.mjs](../../scripts/test-nebius-tools.mjs)),
run 2026-09-23 against the real Token Factory endpoint with stubbed tools over
a fictional site, so no answer is reachable from model knowledge. 73/73 checks
passed on Nemotron 3 Nano:

- Tool calls come back parsed in `message.tool_calls` with `content: null`,
  arguments as a JSON **string**, and `finish_reason: "tool_calls"`. No raw
  markup leaks into content on a normal round.
- Streamed argument fragments arrive in pieces (3 on Nano, 4 on Super) and only
  parse once joined by index. `delta.reasoning` streams before `delta.content`
  (~0.5s vs ~1.1s), as already documented for the non-agentic path.
- Multi-round conversations with `role: "tool"` messages are accepted, echoing
  the assistant turn back **without** its `reasoning` field.
- An on-page question is answered with no tool call; an off-page one searches.
- A pronoun follow-up ("what else has **she** written?") produced the query
  `Dana Reyes`, which is problem 1 above fixed by construction.
- An empty result set produced a second, different query; a snippet without the
  answer produced a `fetch_page` call on the result URL.
- Re-sending the page each round is cheap: on a ~100K-char page, 21,120 of
  23,454 prompt tokens came back cached, and the first round dropped from 2.8s
  cold to 1.5s warm.

## Consequences

- Call count is unchanged for the common cases (1 call on-page, 2 off-page).
  Cost only grows when the model refines, which the round cap bounds.
- The SSE parser gains tool-call fragment joining on top of the existing
  partial-line buffering. Tool rounds also emit one whitespace-only content
  delta, and answers start with `\n`; both need trimming in the UI.
- Losing the strict schema loses the forced `found_in_page` decision, which was
  an accidental guard against answering from model knowledge. A small eval set
  (on-page, off-page, partial, follow-up) measuring tool-call rate and grounding
  replaces it, and doubles as evidence for the hackathon write-up.
- [schema.ts](../../src/background/nebius/schema.ts) and its test shift from
  parsing a response envelope to parsing tool arguments.
- Not yet implemented as of 2026-09-25: the Phase 3/4 code described above is
  still what runs.
