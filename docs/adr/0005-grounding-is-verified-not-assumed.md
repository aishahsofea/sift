# 5. Grounding is verified, not inferred from the absence of a tool call

- Status: proposed
- Date: 2026-09-26
- Related: [ADR 0001](0001-model-driven-agent-loop.md),
  [ADR 0004](0004-fetch-page-url-allowlist.md)

## Context

[ADR 0001](0001-model-driven-agent-loop.md) is careful about one half of the
labelling problem: the "from the page" / "from the web" label is "derived from the
tool calls that actually happened, never from a claim in the model's output."

The half it does not cover is that **absence of a tool call is not evidence of page
grounding**. `ChatTurn['source']` is `'page' | 'web'`
([src/shared/types.ts:17](../../src/shared/types.ts#L17)) and
[agentLoop.ts:122](../../src/background/handlers/agentLoop.ts#L122) derives it from
`state.usedWeb` alone. With only two states, "answered from neither" falls through
to `'page'` — the label that most invites trust.

#5 is that failure observed. On
`transformer-circuits.pub/2025/attribution-graphs/biology.html`, a question about
the paper's jailbreak analysis returned a long, confident answer labelled "from the
page" that inverted the defining detail of the attack.

It could not have been grounded, and the reason is ours rather than the model's.
`truncate()` keeps the first `TRUNCATION_CHAR_LIMIT` (120,000) chars; the body of
"Life of a Jailbreak" starts past 126,000 chars of the source. What survived the
cut was the visual table-of-contents entry naming the section (~6,400) and a
one-sentence abstract summary of it (~19,300): *"an attack which works by first
tricking the model into starting to give dangerous instructions 'without
realizing it,' after which..."*

So the model held a heading and a summary with no body. That is the worst state to
be in — enough to know the section exists, not enough to answer it — and head
truncation manufactures it on every long page. Two further details matter for the
design:

- Truncation is invisible on both sides. `ExtractedPage.truncated` is set and never
  read: nothing reaches the panel, and the system prompt presents `page.content` as
  the page. The instruction the model already has ("if the page doesn't cover the
  question, say so", "search instead") cannot fire, because nothing tells it that
  what it holds is a fragment.
- The answer was *partly* grounded. The "why does it keep going" mechanism came
  from the in-context abstract; the attack description was invented. A per-answer
  grounding verdict is therefore a floor, not proof.

The industry pattern for the general problem splits into two tiers. Post-hoc
groundedness scoring with an NLI judge, as in
[Bedrock Guardrails contextual grounding](https://www.infoworld.com/article/2515588/amazon-bedrock-updated-with-contextual-grounding-rag-connectors.html)
and [Azure Content Safety groundedness detection](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/concepts/groundedness),
costs a model call per answer. Quote-then-answer with verbatim verification
([Learning Fine-Grained Grounded Citations](https://arxiv.org/abs/2408.04568),
[Explicit Evidence Grounding via Structured Inline Citation Generation](https://arxiv.org/html/2606.07130))
costs a round and a substring match, and the verification is deterministic code
rather than a second model's opinion.

## Decision

Three rules, and a shape for the work that follows from them.

**1. A label is a claim we have to be able to back.** `source` widens to
`'page' | 'web' | 'page+web' | 'unverified'`. `'unverified'` is what an answer gets
when nothing ties it to text we supplied. It is a real state with its own chip in
the panel, not an error and not a fallback to `'page'`.

**2. Page grounding is established by a verified quote, not by silence.** The model
calls `cite_page(quotes)` before its final answer on any turn where no web tool
ran. The handler checks each quote is a substring of the page text, normalizing
whitespace on both sides. A quote it cannot find comes back as a tool-role error
the model can recover from, exactly as the `fetch_page` allowlist does
([ADR 0004](0004-fetch-page-url-allowlist.md)) — and for the same reason: the model
is not the enforcement point. At least one quote verified gives `'page'`; the tool
skipped, or nothing verified, gives `'unverified'`.

No NLI judge in the extension. It is an extra model call in a side panel where
latency is the product, and it buys a graded score where a substring match already
gives a hard floor. It belongs in the eval harness (#3), where a judge call per
case costs nothing a user waits for.

**3. What we withheld is stated, to the model and to the user.** The system prompt
names the truncation in chars and says the later sections are absent. The panel
shows the page as truncated before the first question, and shows it per answer.

**And truncation stops being how long pages are handled.** The full extracted text
is retained in `chrome.storage.session` while only the head goes in the prompt — so
the cacheable identical prefix ADR 0001 depends on survives — and a local
`search_page(query)` tool scans the whole text and returns ranked chunks with char
offsets. No API call, no embeddings, no new dependency. It is what turns the #5
question from an honest abstention into a grounded answer, and it is what makes
rule 2 checkable against the whole page rather than only the head.

Tracked as #12 (rule 1 and 3), #10 (rule 2) and #11 (the truncation fix), in that
order: #12 makes the bug non-dangerous on its own, #11 removes the cause, #10 buys
the rigour and costs a round that #3 has to price first.

## Verification

None yet — this record is `proposed` and nothing here has been measured. What has
been checked is the diagnosis, against the live page on 2026-09-26: the source is
246,323 chars, "jailbreak" first appears at ~6,400 in the visual table of contents
and ~19,300 in the abstract's summary of the section, and the section body begins
past 126,700 — past the 120,000-char limit. That is consistent with the cached
`ExtractedPage` recorded in #5 (`chars: 120000, truncated: true, hasJailbreak: false`).

Before this moves to `accepted`, #3 has to report, on the cases added there:
ungrounded-answer-labelled-`page` rate (which has to be 0), quote-verification pass
rate, false-abstention rate, and the rounds and latency `cite_page` adds to an
ordinary on-page question.

## Consequences

- A fourth `source` state means the panel has to say what `'unverified'` means in
  words a user can act on. "Not traced to the page" is the honest reading; "the
  model made this up" is not, since an unverified answer may still be correct.
- One verified quote does not make a whole answer grounded, as #5's partly-grounded
  answer shows. This buys detection of "nothing tied it to the page", not per-claim
  attribution. Chip wording must not overclaim, and per-claim attribution stays an
  open question rather than something this record settles.
- `cite_page` adds a round to the common on-page case, which was previously one
  call. The round cap from [ADR 0003](0003-forcing-the-final-answer.md) still
  bounds the worst case, but the ordinary case gets more expensive and #3 has to
  say by how much.
- Verification pushes toward abstention, and abstention has its own failure mode.
  A false-abstention rate is therefore a first-class metric, not a footnote: a
  panel that shrugs at answerable questions is worse than one that occasionally
  over-claims.
- Quotes verified per turn are worth storing on the turn, which makes an evidence
  view in the panel possible later. Not part of this decision.
- `search_page` needs no network, so it should be offered even with no Tavily key
  configured. The no-key path stops being a single blind round, which is a change
  to the degraded behaviour ADR 0001 describes.
