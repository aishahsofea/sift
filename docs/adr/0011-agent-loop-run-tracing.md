# 11. Trace each agent-loop run

- Status: proposed
- Date: 2026-10-01
- Related: [ADR 0001](0001-model-driven-agent-loop.md), [ADR 0003](0003-forcing-the-final-answer.md), [ADR 0005](0005-grounding-is-verified-not-assumed.md), issue #18

## Context

The agent loop's only observability was one `console.log` line, built from
in-memory state and gone when the request ended. Two bugs (#5, #7) were
diagnosed by hand, by reading `chrome.storage.session` directly and reading step
labels off the panel, because nothing durable recorded what a run did. The live
numbers in ADR 0005 came from one-off script runs and now exist only as prose.

## Decision

Every `START_ASK` run produces one `AgentTrace`, written when the run ends by any
route: answered, errored, or the panel closed.

- **Recorder.** `createTraceRecorder` / `recordRound` / `summarizeToolCall` /
  `finalizeTrace` in
  [traceRecorder.ts](../../src/background/handlers/traceRecorder.ts) are pure and
  unit-tested with no `chrome.*`. The recorder rides on `ToolContext`;
  `agentLoop.ts` is the only caller that persists (`appendTrace`).
- **Storage.** `chrome.storage.session`, one global list capped at
  `MAX_TRACE_RUNS` (15), oldest dropped first. `appendTrace` never rejects, so a
  quota failure costs the trace, not the answer.
- **Content toggle, off by default.** A preference in `chrome.storage.local`.
  Off, a trace keeps counts, lengths, verdicts and tool-call summaries only. On,
  it also keeps question, answer, tool args/results, discarded answers and
  reasoning. Reasoning is under the same toggle and is never shown in the panel
  either way. Off by default so a trace is safe to paste into an issue.
- **Correlation.** `ASK_DONE` and `ASK_ERROR` carry a `traceId`.
- **Per-round data.** The Nebius client sends `stream_options.include_usage` and
  returns model, usage (including `cached_tokens`), finish reason, timing and
  reasoning. A round with no usage chunk records usage as missing, never zero.
- **`logTurn`** takes the finalized trace for tools called/offered, `askedToQuote`
  and source. Verified-quote and passage counts and the problem list still come
  from `LoopState`: the trace holds them only as prose in tool-call summaries.
- **Viewer.** A "Recent runs" list on the Options page reads storage directly:
  newest first, expandable rows, Copy JSON, manual Refresh.

## Consequences

- Each eval file mocks `agentTraces`, because the eval environment has no
  `chrome` stub. A new eval file needs the same mock or it throws
  `chrome is not defined`.
- `promptHash` is a diffing fingerprint, not a wording checksum. The page text is
  spliced out before hashing, but `buildAgentSystemPrompt` also interpolates the
  hostname and `charsOmitted` into its sentences, so the hash shifts with those.
  Fixing that would need a prompt-assembly refactor.
- Rejected cite_page quotes are reclassified in the trace layer (too short vs not
  found) because `verifyQuotes.ts` clips its error strings to 80 characters for
  the model's budget.
- Traces live in session storage, so they vanish when the browser closes.
- Traces are for people, not the loop: nothing reads them back to change behaviour.
- Not in scope: a hosted tracer or exporter, automatic answer grading (#3), and
  making `scripts/test-nebius-tools.mjs` emit the same shape.

## Verification

Not yet done live. Unit tests cover the client's handling of a usage-only
terminal chunk, but whether Nebius really returns `cached_tokens` when
`include_usage` is set is unconfirmed. Check it with a real run of
`npm run test:tools` before moving this to `accepted`, and record the result
here.
