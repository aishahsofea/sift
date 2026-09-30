# 10. Abort a stalled Nebius stream on silence, not total duration

- Status: accepted
- Date: 2026-09-30
- Related: [ADR 0001](0001-model-driven-agent-loop.md)

## Context

`streamAgentTurn` ([src/background/nebius/client.ts](../../src/background/nebius/client.ts))
sends the chat-completions request through `withRetry`
([src/shared/withRetry.ts](../../src/shared/withRetry.ts)) with no signal and no
timeout anywhere in the call, then reads the SSE body itself in a `while (true)`
loop with none either. If Nebius stops sending bytes — during connect or
mid-stream — nothing aborts it; the request hangs until the socket dies, and the
whole agent loop hangs with it.

This was hit live: the first run of the `#7` eval had three stalls that ran
941s, 915s and 161s before Vitest's own test timeout gave up (unable to abort
the in-flight fetch). As a stopgap, the eval file patches `globalThis.fetch`
with a flat `AbortSignal.timeout(90_000)`
([fetchPageEscalation.eval.ts](../../src/eval/fetchPageEscalation.eval.ts)) —
workable for a test harness, but wrong for production: a flat timeout would
kill a legitimately long-streaming answer along with a genuinely stalled one.

## Decision

Abort the request based on **silence** (no bytes for a fixed window), not total
duration:

- `NEBIUS_STREAM_IDLE_TIMEOUT_MS` (30s) in
  [src/shared/constants.ts](../../src/shared/constants.ts) — commented as
  silence-based and tunable, since no per-chunk cadence data was available to
  derive it precisely.
- `streamAgentTurn` creates one `AbortController` per call, arms a `setTimeout`
  before the request, and re-arms it after the fetch resolves and after every
  `reader.read()` in the streaming loop. Cleared in a `finally` so nothing
  leaks on normal completion or any throw. The abort reason is a descriptive
  `Error` (`Nebius stream timed out — no data for 30s. Try asking again.`),
  not the default `AbortError`, so the message that reaches `ASK_ERROR` is
  specific.
- **Nebius-only, not a shared `withRetry` default.** Tavily's two calls
  (`searchTavily`/`extractTavily`) are plain request/response with no streamed
  body — "silence between chunks" isn't a meaningful concept for them, and the
  issue reported no Tavily hangs.
- `withRetry`'s catch now rethrows immediately when `init.signal?.aborted` is
  true, ahead of its existing retry logic. Without this, passing an abort
  signal into `withRetry` would have it treat a deliberate abort exactly like a
  transient network failure and retry once — silently doubling the stall wait
  before the user sees anything. This is the right general semantic for a
  shared retry helper (never retry a caller's own cancellation), and it changes
  nothing for Tavily, which never passes a signal.
- No change to the error-surfacing path: `runAgentLoop`'s existing top-level
  `try/catch` already turns any thrown error into `ASK_ERROR`
  ([agentLoop.ts](../../src/background/handlers/agentLoop.ts)), so a stall
  reaching the user needed no new wiring, only something to throw.

## Consequences

- `searchTavily`/`extractTavily` are unaffected: no signal, no timeout, same
  behavior as before.
- `resolveNemotronModel`'s raw `fetch`
  ([modelDiscovery.ts](../../src/background/nebius/modelDiscovery.ts)) is left
  untouched — out of scope here, and its exposure is limited to a cold
  service-worker start since the result is cached for the worker's lifetime.
  Worth a small follow-up issue if it turns out to stall in practice.
- 30s is a starting point, not a measured threshold — real per-chunk cadence
  data would let it be tightened or loosened with more confidence.
- `useAskStream`/`useChat`/the side panel needed no changes: they already
  render whatever `ASK_ERROR` sends.
