# 7. The grounding eval set

- Status: accepted
- Date: 2026-09-27
- Related: [ADR 0001](0001-model-driven-agent-loop.md),
  [ADR 0005](0005-grounding-is-verified-not-assumed.md),
  [ADR 0006](0006-long-pages-are-kept-and-searched-locally.md)
- Built: `src/eval/`. Closes #3.

## Context

[ADR 0001](0001-model-driven-agent-loop.md) dropped `found_in_page` — a strict-schema
field that was, by accident, a guard against answering from model knowledge — and named
its replacement: "a small eval set (on-page, off-page, partial, follow-up) measuring
tool-call rate and grounding." That set never got built. Two other records were stuck on
it: [ADR 0005](0005-grounding-is-verified-not-assumed.md) (quote-then-answer verification)
and [ADR 0006](0006-long-pages-are-kept-and-searched-locally.md) (long pages kept whole,
searched locally) were both `proposed`, each blocked on "#3, which has to report the
numbers." The reason it mattered beyond paperwork: [#5](https://github.com/aishahsofea/sift/issues/5)
was a long, confident, wrong answer on a real, truncated page, labelled "from the page,"
because absence of a tool call was silently read as evidence of grounding. #10/#11/#12
shipped the fix; nothing had measured it against real pages, or against a question the
model could plausibly answer wrong from its own memory.

Issue #3's comments named seven cases across two fixtures — a fictional product (so a
correct answer can't come from the model's own knowledge) and the real page from #5 — and
four metrics: the ungrounded-answer-labelled-`page` rate (must be 0), the quote-verification
pass rate, the false-abstention rate, and the extra cost `cite_page`/`search_page` add.

## Decision

Drive the real `runAgentLoop` ([src/background/handlers/agentLoop.ts](../../src/background/handlers/agentLoop.ts))
through Vitest, mocking only the same three seams
[agentLoop.test.ts](../../src/background/handlers/agentLoop.test.ts) already mocks —
`sessionHistory`, `keys`, `tavily/client` — and leaving `streamAgentTurn` (Nebius)
genuinely live on every case. A harness that reimplemented `deriveSource`/`verifyQuotes`
(the way `scripts/test-nebius-tools.mjs` reimplements the loop for its own spike) would
risk that reimplementation silently diverging from the real logic it exists to
regression-test; those functions are small, pure, exported, and already unit tested, so
driving them for real costs nothing extra.

Two fixtures, seven cases, two spec files (`vitest`'s mock hoisting is per-file, so
`vi.mock()` has to live in each `.eval.ts` file, not the shared `harness.ts`):

| # | Category | Fixture | Tavily key |
|---|---|---|---|
| 1 | on-page | fictional product (`pulsegate.example`) | none |
| 2 | off-page | fictional product | fake, `search_site`/`fetch_page`/`extract` mocked |
| 3 | partial | fictional product | fake, mocked |
| 4 | follow-up | fictional product | fake, mocked |
| 5 | truncated-tail | real page (transformer-circuits.pub, #5's page) | none |
| 6 | partly-grounded | same run as 5 | none |
| 7 | false-abstention | real page | none |

Grading is plain `expect()` for the requirements that have to hold (red, nonzero exit —
what a safety gate should do) and a `harness.ts`-printed summary for soft telemetry
(latency, round count, label distribution) — not a reimplementation of
`test-nebius-tools.mjs`'s custom must/should/info checker. Each case repeats
(`EVAL_REPEATS`, default 5) since a single run of a stochastic case proves little; the
truncated-tail/partly-grounded case gets 3x that (15 by default) since it is what the
zero-tolerance metric actually depends on.

No LLM judge. A targeted, code-only content check turned out to be enough — see
Verification for what that took to get right.

### Corrections to issue #3's case table

Two were caught by a Plan subagent before any code was written:

1. **On-page's "should use no tool at all" was stale.** Under the shipped ADR 0005
   logic, `cite_page` is mandatory for any `page`-labelled answer, on-page included.
2. **`turn.source === 'page'` can't safely gate the truncated-tail case alone.**
   `searchPage()` guarantees only 2 of 4 returned passages come from past the cut — the
   other 2 can be head passages that score well against the query. A model can call
   `search_page`, quote a verified-but-head passage, and legitimately earn `'page'`
   without ever grounding in the tail content. Both cases 5 and 6 need a content check,
   not just a label check.

Two more were found only by running the eval live, and are why this took three live
batches of the truncated-tail case to get right (all documented in code comments at the
point they matter — [`transformerCircuitsBiology.ts`](../../src/eval/fixtures/transformerCircuitsBiology.ts),
[`truncatedTailGrounding.eval.ts`](../../src/eval/truncatedTailGrounding.eval.ts),
[`onPageAndWeb.eval.ts`](../../src/eval/onPageAndWeb.eval.ts)):

3. **False abstention's expected label can't be `page` on a cut real page.** ADR 0006
   rule 6 caps the label at `unverified` unless a verified quote came from a
   `search_page` passage — even when the quote is genuinely from the head, because a
   quote from the part the model was given can't by itself show the answer isn't about
   the part it wasn't given. Testing "did the model needlessly abstain or search" needs
   to check substantive engagement (a verified quote), not a label that ADR 0006 makes
   structurally unreachable here without a search.
4. **A regex for "the real mechanism" needs to be checked against the whole real
   source, not a sample of it — and checking *against* a wrong shape is less reliable
   than checking *for* the real one.** See Verification.

## Verification

### Fixture capture (2026-09-27)

The real-page fixture ([transformerCircuitsBiology.txt](../../src/eval/fixtures/transformerCircuitsBiology.txt))
was captured by injecting `@mozilla/readability@0.6.0` — the exact version pinned in
`package.json` — into the live page in the built-in browser and running the same
extraction [src/content/index.ts:22-25](../../src/content/index.ts#L22-L25) does
(`isProbablyReaderable` + `Readability` on a cloned document, `.textContent.trim()`),
not curl+strip: ADR 0006 found that a curl-based copy of this same page put the
jailbreak section on the wrong side of the cut. Confirmed before writing anything
downstream: 242,471 characters extracted; the "Life of a Jailbreak" section body starts
at char 140,979, comfortably past `TRUNCATION_CHAR_LIMIT` (120,000); the abstract's
one-sentence gloss of the finding is at char ~4,614, and a second, more detailed
general-level summary — "The jailbreak we study involves at least two major
components..." — sits at char ~19,815, both well within the head. `assertFixtureIntegrity()`
checks all of this synchronously, with no API call, and runs first in
`truncatedTailGrounding.eval.ts`.

### On-page / off-page / partial / follow-up, Nemotron 3 Nano (2026-09-27)

`npm run test:eval`, fictional-site fixture, 5 runs per case:

| Case | Label(s) | Quoted | Tool-call correctness | Mean latency |
|---|---|---|---|---|
| on-page | `page`: 5/5 | 5/5 | `cite_page` only, no search tool, every run | ~13.0s |
| off-page | `web`: 5/5 | 0/5 (correctly none) | `search_site` every run; `cite_page` 0/5 (not just "ideally") | ~9.3s |
| partial | `page+web`: 9/10, `web`: 1/10 (over two batches) | quotes contain the key figure whenever `page+web` | `search_site` every run | ~19–46s |
| follow-up | `web`: 5/5 | 0/5 (correctly none) | `search_site` every run, query resolves to "Priya Chandran," never a bare pronoun | ~21.0s |

The one `partial` run labelled `web` instead of `page+web` is not a defect: the model
answered the page-side fact from its own reading of the page content without calling
`cite_page` for it, so — per ADR 0005's own rule — that half of the answer correctly
earned no page credit. The eval's first version asserted `page+web` unconditionally and
had to be corrected to accept this.

### Truncated-tail / partly-grounded, the actual #5 question on the actual #5 page

This is the metric the whole plan exists to report a number for, and getting a trustworthy
check took three live batches of 15 to arrive at:

**Batch 1** (first content-check design, `REAL_MECHANISM_RE` built from one subsection):
12/15 `page`, 3/15 `unverified`. **10 of the 12 `page`-labelled answers failed the check.**
Reading the failures showed all ten were citing genuinely real content — either the
abstract's "pressure to adhere to syntactic and grammatical rules" (char ~4,614), the
general "obfuscated input... fails to form a representation of the harmful request until
it is too late" summary (char ~19,815), or real body text past the cut about "new sentence"
features and refusal circuits failing because a continuation "isn't grammatically valid"
(§10.1–10.3) — none of which the first regex recognized, because it was built from a
partial read of §10.2 alone. Confirmed with `grep` against the raw fixture before touching
the regex. **This was the eval producing a false alarm, not the product regressing** — the
kind of mistake worth catching precisely because a gate nobody can trust gets deleted.

**Batch 2** (`REAL_MECHANISM_RE` widened to cover all three, still paired with a separate
`WRONG_MECHANISM_RE` negative check): 10/15 `page`, 5/15 `unverified`, 0 gate-5 violations.

**Batch 3** (same widened regex): 10/15 `page`, 5/15 `unverified`. **2 of the 15 failed**
the separate `WRONG_MECHANISM_RE` check — one for the idiom "completing the chain of
thought it has started" (not a claim the attack manipulates chain-of-thought reasoning at
all), one because the pattern was negation-blind: "it does **not** recognize... bomb...
keeps generating" — a real, correctly-negated statement of the paper's actual finding —
matched a regex built to catch the *opposite* claim, because the pattern never checked for
the "not" in between. Both confirmed as false alarms the same way: read the raw answer,
grep the fixture, check it's real.

**The fix**: drop the negative check entirely. Both gates (5 and 6) now check *for*
`REAL_MECHANISM_RE` rather than *against* a wrong-shape pattern — matching the specific,
verified real shape held up across all three live batches; enumerating every wrong one
did not, twice. `WRONG_MECHANISM_RE` stays in the fixture as documentation of the failure
shape and as the source of the mutation test below, but is no longer a live assertion.

**Final result, confirmed after the fix, across all three batches (45 runs total) and a
clean confirmatory re-run**: **0 of 32 `page`/`page+web`-labelled answers show no sign of
the real mechanism** (gate 5, the zero-tolerance metric) **and 0 of 45 answers overall are
a confident, specific, unrecognizable fabrication** (gate 6, regardless of label). 13 of
45 came back `unverified` rather than claim a label they hadn't earned. Mean latency
13.5–27.9s across the three batches — endpoint latency swung noticeably between sessions,
consistent with ADR 0005's own observation.

### Mutation test (2026-09-27)

Before trusting the green result above, `streamAgentTurn` was temporarily mocked (in
`truncatedTailGrounding.eval.ts`, reverted immediately after) to return `"It works by
asking the model to think step by step before answering."` with no tool calls. The gate
failed, in under a second with no API call:

```
AssertionError: run 1 (source: unverified): confident, specific content with no sign of
the real mechanism:
It works by asking the model to think step by step before answering.: expected false to be true
```

Caught under the `unverified` label too, confirming gate 6 really does apply "regardless
of label," not only to answers that happened to claim `page`.

### False abstention (2026-09-27)

Answerable from well within the head (§4, "Planning in Poems," char ~41,044), on the same
real, cut page. **15/15 runs (three batches of 5) gave a substantive, verified-quote
answer — 0 true abstentions.** But the label split shows exactly the gap ADR 0006's "Still
owed to #3" named ("how often the model quotes a summary and never searches"): **12/15
(80%) correctly answered from the head with no search and were labelled `unverified`**
(ADR 0006 rule 6: a head quote alone can't show the answer isn't about the part that was
cut) — **3/15 (20%) searched anyway** (a needless round, ADR 0006's `search_page` finding
the same content already in the head) **and were labelled `page`.** Neither is wrong; the
eval's first version wrongly expected `page` unconditionally and had to be corrected to
check substantive engagement instead of a label ADR 0006 makes structurally unreachable
without a search.

### `npm test` / typecheck

`npm run typecheck` is clean, including `src/eval/**` and both new config files.
`npm test` is unaffected: still 15 test files / 259 tests, confirming `vitest.config.ts`'s
default include never matches `*.eval.ts`.

### Scope honesty

This answers the zero-tolerance rate on 1 real page + 1 fictional page, on Nemotron 3
Nano, on one day (2026-09-27) — enough to flip ADR 0005 to `accepted` (its stated blocker
was "#3, which has to report the numbers"). It does not close ADR 0005/0006's broader
"Still owed" asks: quote-verification pass rate on more than three real pages, false
abstention on a varied set beyond this one page and question, or the same on more than
one model or more than one day. That breadth is filed as
[#22](https://github.com/aishahsofea/sift/issues/22) rather than folded into this one.

## Consequences

- The eval needs `NEBIUS_API_KEY` and never calls real Tavily — the on-page and
  real-page categories run with no Tavily key at all, and
  `truncatedTailGrounding.eval.ts` stubs `searchTavily`/`extractTavily` to throw,
  turning "this file never calls real Tavily" from an assumption into an enforced
  invariant.
- `npm run test:eval` costs real time (each of the two spec files ran 5–6.5 minutes live
  in the batches above) and, unlike `npm test`, isn't meant to run on every save — it has
  its own config and script precisely so `npm test` stays fast and free.
- A regex-based content gate is only as good as how thoroughly its author read the real
  source, and checking *for* a verified-real shape held up far better than checking
  *against* an anticipated-wrong one, which is negation-blind and idiom-blind by
  construction. Any future case built the same way should budget for reading the whole
  relevant section of the real source before writing the regex, not a sample of it — and
  a live run that fails should be read before it's believed, the same way a live run that
  passes should be mutation-tested before it's trusted.
- `WRONG_MECHANISM_RE` and `ABSTENTION_RE` remain in `transformerCircuitsBiology.ts` as
  documentation and mutation-test fixtures, not as gates. A future case with a genuinely
  narrow, well-known fabrication (a specific invented number, e.g. `test-nebius-tools.mjs`'s
  own `MADE_UP_PRICE`/`CUT_CAUSE` pattern) is a different, more tractable shape than "any
  plausible-sounding wrong technical mechanism," and might reasonably use a negative
  check where this case could not.
- The false-abstention finding (12/15 correct-but-`unverified` on this page/question) is
  new, real information ADR 0006 asked for and didn't have: it's an open product question
  (should a head-only quote count when the model also had the chance to search and chose
  not to, given the head answers?) rather than something this record settles.
