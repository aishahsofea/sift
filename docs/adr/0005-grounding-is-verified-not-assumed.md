# 5. Grounding is verified, not inferred from the absence of a tool call

- Status: proposed
- Date: 2026-09-26
- Related: [ADR 0001](0001-model-driven-agent-loop.md),
  [ADR 0004](0004-fetch-page-url-allowlist.md)
- Built: rules 1 and 3 in #12, rule 2 in #10. Still `proposed` because #3, which
  has to report the numbers under Verification, does not exist yet.

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

## Implementation of rule 2 (#10)

What the rule became in code, including the parts it did not say.

- `cite_page(quotes: string[])` is a third tool next to `search_site` and
  `fetch_page`. It needs no network, so it is offered with no Tavily key too. That
  path is now `cite_page`, then the answer: two rounds, not one.
- A quote is checked against what the system prompt presents as the page: the
  title, the byline and the content, not the URL. On Distill-style pages the byline
  is not in `content` at all (#6), so "who wrote this?" could never verify
  otherwise. Whitespace is collapsed on both sides with `\s`, which covers the
  no-break and narrow no-break spaces Nemotron writes into dates and names. The
  match is otherwise verbatim and case-sensitive: a paraphrase in quotation marks,
  or an ellipsis joining two fragments, does not verify.
- A quote under 10 characters is rejected. A blank string is a substring of every
  page, and a word or two of any page verifies, so neither ties an answer to
  anything.
- The label comes from three facts: a web tool returned something, a quote
  verified, the page was cut. Web plus a quote is `page+web`, web alone is `web`, a
  cut page is `unverified`, a quote is `page`, and nothing is `unverified`.
- **A cut page skips the tool.** The label is capped at `unverified` there,
  because a quote from the head cannot show that the answer was not about the part
  that was cut, which is #5. A round that cannot change the label is a round for
  nothing, so `cite_page` is not offered, not mentioned in the prompt, and refused
  if called anyway. #11 is what changes this.
- The verified quotes are stored on the turn (`ChatTurn.quotes`). The chip says how
  many were checked ("from the page · 1 quote checked"), not that the answer was.
  There is no evidence view yet.
- A `cite_page` round counts against `MAX_TOOL_ROUNDS` like any other.
- With both search and `cite_page` on, the prompt gives the model two paths to an
  answer, and `cite_page` belongs to the page path only. Each search and fetch
  result also carries a note that it is not the page. Both were needed; see below.
- Quotes are asked for short: up to three, a sentence or less each. On real pages
  the rejections were long quotes the model had edited while copying them.
- Once one quote has verified, the result tells the model to answer and not to cite
  again. Quotes that did not verify are listed but not to be fixed: the answer uses
  what verified, so a claim the model could not quote is left out rather than
  argued over in another round. Only a call that verifies nothing gets the error
  and the hint to copy exactly, which is the "corrected round" rule 2 asks for.
- **An uncited answer is discarded and asked for again, once.** If the model
  answers a page question without calling any tool, the answer is neither shown nor
  stored, and the model is asked, for that request only, to call `cite_page` first
  or to say the page does not cover the question. It does not use up a tool round.
  A second uncited answer is kept as `unverified`. A model that has searched is not
  asked, even if the search found nothing. This is quote-first on purpose: asking
  the model to cite an answer it has already written lets it find passages that
  merely relate to something it made up, which is #5's failure labelled `page`.
- The chip for `unverified` says "not checked against the page", or "not checked ·
  page was cut short", in grey, with a hover sentence that the answer may still be
  right. It was amber and said "unverified · not traced to the page". After a real
  click-through that read as an accusation on answers that were fine: the
  false-abstention cost, in the flesh. The state is still `unverified` in code; only
  what the panel says about it changed.
- The forced final round on a whole page has its own nudge, which names `cite_page`
  and says no tool at all, and asks once more if the model still calls one. The old
  nudge only said "searches", which left "quote before you answer" standing, and on
  real pages the model reached for `cite_page` in a round that had no tools.
- Each answer logs one line to the service worker console: the label, the tools
  called, what `cite_page` did, which quotes were rejected, and whether the model
  was asked to quote first. On a real page an amber chip has several causes that look
  the same in the panel.

## Verification

### Diagnosis (2026-09-26)

Checked against the live page: the source is 246,323 chars, "jailbreak" first
appears at ~6,400 in the visual table of contents and ~19,300 in the abstract's
summary of the section, and the section body begins past 126,700 — past the
120,000-char limit. That is consistent with the cached `ExtractedPage` recorded in
#5 (`chars: 120000, truncated: true, hasJailbreak: false`).

### `cite_page` on Nemotron 3 Nano (2026-09-26)

`npm run test:tools`, against the real endpoint, on the fictional-site fixture with
search stubbed, so no answer is knowable from model memory. The script keeps its
own copy of the prompt and tool wording; `spikeParity.test.ts` fails if the two
drift. Latency moved by 5× between sessions on the same endpoint, so only runs done
at the same time are compared.

- **The array argument works.** `quotes` arrives as a JSON string in
  `function.arguments` and streams in 3 fragments that join by index, like the
  string arguments. Every `cite_page` call in the runs below parsed.
- **The first wording failed on search questions.** One line ("before you answer
  from the page, call `cite_page`") was read as a step in every answer. In 11 of 12
  search runs (six flows, two runs each) the model searched, then cited the snippet
  ("it matches the page"), got `quote not found`, fetched to try again, reached the
  round cap, and in 8 of the 12 the forced round came back as a tool call or raw
  markup, which the handler treats as an error. Telling the model in the system
  prompt and the tool description that results cannot be cited changed nothing (2 of
  2). Two explicit paths in the prompt alone left it citing after a fetch in 3 of 6
  runs; a note in the result alone, in 6 of 6. Both together, with the note worded
  for the tool it comes back from, took it to 0 of 47 runs, with the same rounds as
  the `--no-cite` baseline in every flow (2, 2, 3, 3, 2, 2). The lesson is that a
  tool on offer gets used, and the wording that scopes it is load-bearing.
- **Copying is reliable on this fixture.** On the seven on-page cases (109 runs)
  `cite_page` was the first call every time and a quote verified every time. 154
  quotes were checked and 151 verified. The 3 rejections were one misquote in 2
  runs, "co-author" for "co-founder", and both runs still ended with a verified
  quote. A paragraph with curly quotes, an em dash, an ellipsis character and a
  non-breaking hyphen was copied exactly in 7 of 7. So nothing beyond whitespace is
  normalized yet.
- **A rejected quote is recoverable.** With the first call rejected on purpose, 5
  of 7 runs re-cited and got a quote through, 1 searched instead, and 1 spent 8,192
  tokens thinking (`finish_reason: length`, 74 s) and returned nothing, which the
  handler reports as an error. That case rejects a quote the model is right about,
  which a real rejection does not, but it shows what a spurious one would cost.
- **Without search, the model does not invent quotes.** On an off-page question
  (7 runs) it never called `cite_page`. On a question the page half-covers (guest
  seats exist, no price; 9 runs) it said the page gives no price every time and
  called `cite_page` once.
- **Page and web still combine.** On a question needing both (6 runs) the model
  cited the page and searched in 5, and searched only in 1; every answer had both
  facts.

**Cost on the fixture, measured at the same time as the baseline** (`--no-cite` is the same
prompt and tools without `cite_page`; 6 runs per case):

| Case | Baseline | With `cite_page` | Completion tokens |
|---|---|---|---|
| on-page: count | 1 round, 1.3 s | 2 rounds, 6.8 s | 111 → 640 |
| on-page: author | 1.3 s | 7.7 s | 104 → 680 |
| on-page: three features | 2.6 s | 15.0 s | 240 → 1,376 |
| on-page: date | 2.0 s | 7.5 s | 158 → 743 |
| on-page, 100K-char page | 1.6 s | 6.3 s | 109 → 602 |
| page and web together | 8.8 s (2.0 rounds) | 25.5 s (2.8 rounds) | 785 → 2,455 |

A repeat of the `cite_page` column later that session gave 5.6, 13.1, 15.2, 9.4 and
6.3 s. An earlier same-time run under heavier load, on the first wording, gave 1.9×
on the small cases instead of 3.5–6×, since queueing added a fixed delay to both.
The extra time is not the second read of the page: on the 100K-char page 42,240 of
47,434 prompt tokens were cached. It is the model reasoning about which passage to
quote, about 5× the completion tokens. Search flows cost the same rounds and about
230 more prompt tokens per call for the longer prompt and the third tool
definition.

**A lever, not taken.** Token Factory honours
`chat_template_kwargs: { enable_thinking: false }`. On the on-page cite round it
cut a call from 2.2–3.0 s and 250–385 tokens to 0.5–0.9 s and 33–87 (3 runs), but
the model skipped the call in one of the three, and the switch is per request, not
per round, so it would also change how the model decides between citing, searching
and answering. `reasoning_effort: "low"` did nothing. Not adopted here; it needs
its own measurement.

### Real pages (2026-09-26)

The first Chrome click-through gave an amber `unverified` chip on "What are the key
points of this page?", so the same question was run on three real pages
(paulgraham.com/greatwork, the Wikipedia article on prompt engineering, the Python
tutorial on virtual environments), text extracted the way the content script does
(`textContent`, no separators added), through the real `runAgentLoop` against the
live API, 3 runs per page. The fixture understated the cost:

- `main`, with no `cite_page`: 2.4–5.3 s, every answer labelled `page` on nothing.
- This branch: 2.8–39 s. Two rounds in 6 of 9 runs (8.7–17 s), four in 3 (17–39 s), and
  one run in 2.8 s where the model never called `cite_page`: the amber chip.
- On a summary question the model over-cites. One run made 3 calls with 12 quotes,
  every one verified; another 17 quotes. Each extra call is a round.
- The rejections were real edits, not matching failures: "and" dropped from a list, a
  paraphrase inside quotation marks, and a 322-character quote that stitched in a
  sentence the page does not contain ("Furthermore, as AI models continue to
  improve…"). Long quotes are where it slips. The verifier caught them, which is the
  point, and each costs a round.
- An earlier run on a messier extraction (separators between inline tags, which the
  model "fixed" when quoting) ended 2 of 12 runs in an error ("kept searching instead
  of answering", "no answer content"): rejections cascading into the round cap. It did
  not recur in the 9 runs above, but the path is there.
- A cut page is amber every time, by design (3 of 3), in 16–18 s.

So on a whole page the amber chip has two causes that look the same in the panel: the
model skipped the tool (about 1 run in 10 here), or its quotes were rejected. The
handler now logs one line per answer to the service worker console saying which
(`[Sift] tab N answered as …`).

### Tuning on real pages (2026-09-26)

Three changes went in for what the real pages showed: short quotes, "answer now" once
a quote verifies, and discard-and-ask-again for an uncited answer (see Implementation).
The same three pages, each with the summary question, a factual question and a question
the page does not cover (cryptocurrency), 5 runs per cell before and after, with `main`
run in the same window as the after runs (3 runs per cell). Medians, in seconds:

| | `main` | before | after |
|---|---|---|---|
| key points: Paul Graham essay | 13.2 | 18.5 | 13.2 |
| key points: Python tutorial | 7.1 | 20.6 | 17.4 |
| key points: Wikipedia article | 9.8 | 44.1 | 28.0 |
| factual: essay / tutorial / article | 8.5 / 3.5 / 4.6 | 12.8 / 8.8 / 17.6 | 13.0 / 14.8 / 10.8 |

- **Robustness improved.** Of 15 summary runs, hard errors went from 2 ("kept searching
  instead of answering") to 1 ("no answer content", 115 s), and runs with more than one
  `cite_page` call from 4 to 1. The other 44 runs after did not error.
- **The cost did not go away.** Against `main` in the same window the summary question is
  1.0–2.9× and the factual question 1.5–4.2×. The time is in the first round, the one
  that ends in the `cite_page` call: median 9–14 s, against 2.4–5.5 s for the answer
  round after it (4 runs per page, key points). That round is the model reasoning about
  the question and choosing what to copy before it emits the call. Tuning the wording
  does not move it; a floor of about 2× is what quote-then-answer costs on this model.
- **A skipped `cite_page` is handled.** With the first answer forced to skip the tool
  (12 runs), asking again got quotes and a `page` label 12 of 12 times, one call each.
  On the question the page does not cover (12 runs) the model searched or said so: 0 cite
  calls, 0 invented quotes, all `unverified`. A skip that happens by itself is
  about 1 run in 10 on the summary question; it now costs a third round (about 17 s in
  the runs above) instead of an amber chip.
- The fixture suite (`npm run test:tools`, 3 runs per case) passes with the new text:
  576 checks, 0 failures. `cite_page` after a search is 0 of 18 with the same rounds as
  before, on-page cites verify 15 of 15, and the nudge cases cite 3 of 3 and invent
  nothing 3 of 3. Without a search tool an abstention now takes two rounds, not one.

### Short answers and follow-ups (2026-09-26)

Two things a second click-through turned up.

- **Answers are shorter.** The summary question on the same pages: about 2.7k
  characters before the feature and 1.6k after on the essay, 2.5k and 1.0k on the
  tutorial (median of 3; the article's answers varied too much to compare). The answer
  is now written from up to three short quotes and told to "answer now from them", so
  it covers what the quotes cover. That is the design working, and it is also why the
  answers are quicker.
- **Follow-ups can cost several `cite_page` rounds, and used to end in an error.** "Can
  you explain the second point in more detail?" on the article: with `cite_page` result
  saying to answer now, the model still called it again in 8 of 15 runs. It wants more
  passages to explain something in detail, and "using only those" leaves it short of
  evidence. Those runs took 3–5 rounds, up to 79 s. Three times in 18 runs the cap was
  reached and the forced round, with no tools, still came back as a `cite_page` call,
  which was the error "kept searching instead of answering". With the cite-aware nudge
  and one retry: 0 errors in 15 runs, and the retry was needed once. The extra rounds
  are unchanged; capping them, or loosening the note so the model may use the rest of
  the page, are both open and both trade grounding or completeness for speed.

### Still owed to #3

Before this moves to `accepted`, #3 has to report on cases it adds:

- The ungrounded-answer-labelled-`page` rate, which has to be 0. Nothing above
  tests it: no case gives the model an answer from its own memory to quote around.
- The quote-verification pass rate on real pages, on more than three of them. The
  fixture is a short ASCII page and one paragraph of typography, not real markup.
- The false-abstention rate on a varied set. The only data point is above: an
  honest "the page doesn't say" answer had no quote to verify in 8 of 9 runs, so it
  was labelled `unverified`.
- The same on more than one model, and on more than one day.

The whole loop has also not been click-tested in Chrome; everything above is the
real API driven from Node, plus unit tests of the handler with the model faked.

## Consequences

- A fourth `source` state means the panel has to say what `'unverified'` means in
  words a user can act on. "Not checked against the page" is the honest reading;
  "the model made this up" is not, since an unverified answer may still be correct.
  The first wording ("unverified · not traced to the page", in amber) was too strong
  for how often it fires on answers that are fine.
- One verified quote does not make a whole answer grounded, as #5's partly-grounded
  answer shows. This buys detection of "nothing tied it to the page", not per-claim
  attribution. Chip wording must not overclaim, and per-claim attribution stays an
  open question rather than something this record settles.
- `cite_page` adds a round to the common on-page case, which was previously one
  call, and the model reasons about the quote as well as the answer. Measured
  above: 1.3–2.6 s became 6.8–15 s on the fixture, 1.6 s became 6.3 s on a 100K-char
  page, and on real pages the same window gives 1.0–4.2× `main` after tuning. Most of
  it is the first round's reasoning, so it is a property of quote-then-answer, not of
  the wording. The round cap from
  [ADR 0003](0003-forcing-the-final-answer.md) still bounds the worst case. This is
  the price of a check the model cannot argue with, in a panel where latency is the
  product, and whether it is worth paying is the open question, not a settled one.
- An honest "the page doesn't say" answer has no quote to verify, so it gets the
  "not checked" chip too. Code cannot tell an abstention from an invention, so the
  chip is right that nothing ties the answer to the page and unhelpful to a reader
  who was just told the truth.
- A rejection the model believes is wrong is expensive: it can think for thousands
  of tokens. Rejections have to be real. The cheap way to make sure is to
  normalize more than whitespace (typographic quotes and dashes, zero-width
  characters) if #3 finds verbatim copies failing on real pages.
- Verification pushes toward abstention, and abstention has its own failure mode.
  A false-abstention rate is therefore a first-class metric, not a footnote: a
  panel that shrugs at answerable questions is worse than one that occasionally
  over-claims.
- Quotes verified per turn are stored on the turn (#10), which makes an evidence
  view in the panel possible later. The view is not part of this decision.
- `search_page` needs no network, so it should be offered even with no Tavily key
  configured. The no-key path stops being a single blind round, which is a change
  to the degraded behaviour ADR 0001 describes.
