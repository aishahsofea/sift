# 3. End the loop by dropping the tools and nudging, not with `tool_choice: "none"`

- Status: accepted
- Date: 2026-09-25
- Related: [ADR 0001](0001-model-driven-agent-loop.md)

## Context

The loop needs a hard stop: after 3 tool rounds it must produce an answer
instead of searching forever. The obvious mechanism is the OpenAI-compatible
`tool_choice: "none"`, which Nebius documents as supported.

## Decision

On the forced final call, **omit the `tools` parameter entirely and append a
one-off user message** telling the model to answer now:

> You've used all your searches. Answer now from the page and the results
> above. If they don't cover the question, say you couldn't find it.

That message exists only for that request. It is never written to
`chrome.storage.session` history.

Separately, the handler treats any final answer containing `<tool_call>`,
`<TOOLCALL>` or `<function=` markup as a failed answer rather than rendering
it, whichever path produced it.

## Verification

Spike, 2026-09-23, Nemotron 3 Nano, 5 runs per strategy
(`npm run test:tools -- --only=force --repeat=5`):

| Strategy | Clean answer |
|---|---|
| `tool_choice: "none"` | 0/5 |
| `tools` omitted | 0/5 |
| `tools` omitted + nudge message | 5/5 |

In both failing strategies the model asks for another search anyway, and
because no tool parser is active the request comes back as raw text in
`content`:

```
<tool_call>
<function=search_site>
<parameter=query>
Loomkit Pro pricing
</parameter>
</function>
</tool_call>
```

Sift would have rendered that as the answer, which is why the defensive markup
check above is part of this decision and not just a lint.

With the nudge, all five runs said plainly that the price wasn't in the page or
the results, and none invented a number.

## Consequences

- Omitting `tools` also drops the tool definitions from the rendered prompt:
  801 to 413 prompt tokens in the spike, so roughly 390 tokens per call are
  tool schema on this model.
- The nudge is prompt text, so it is model-specific and worth re-checking on
  any model change: `npm run test:tools <model-id> -- --only=force --repeat=5`
  prints the table above. The two rejected strategies stay in the spike as
  opt-in cases for exactly that reason.
- A forced answer is a legitimate outcome, not an error state: the UI should
  show "couldn't find it" rather than a failure.
