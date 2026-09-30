# 9. A cut `fetch_page` result is searched like a cut page

- Status: proposed
- Date: 2026-09-28
- Related: [ADR 0001](0001-model-driven-agent-loop.md),
  [ADR 0004](0004-fetch-page-url-allowlist.md),
  [ADR 0005](0005-grounding-is-verified-not-assumed.md),
  [ADR 0006](0006-long-pages-are-kept-and-searched-locally.md),
  [ADR 0007](0007-grounding-eval-set.md)
- Built: #7, in part. Still `proposed`: the issue's own question is not fixed (see "What
  this does not fix"). The Chrome click-through ran 2026-09-30 (see "Chrome click-through"
  under Verification) — it reconfirmed the gap rather than closing it, and surfaced a new
  one, filed as [#30](https://github.com/aishahsofea/sift/issues/30).

## Context

[#7](https://github.com/aishahsofea/sift/issues/7): on the real biology page, asked about
a pruning algorithm described only in the companion methods paper, the panel showed a
`Searching…` step and stopped: no `Reading…`, no `fetch_page`. The answer, labelled `from
the web`, was a confident four-part description of the algorithm, mostly invented. Unlike
[#5](https://github.com/aishahsofea/sift/issues/5) a tool did run, so the label certified
a retrieval that covered only a one-sentence snippet.

Two causes were proposed, and they were checked differently.

**The escalation note.** `SEARCH_NOTE`, the last thing the model reads after a search,
said only *"Answer from them now, or search again"*; it never named `fetch_page`. ADR 0005
had found on this model that a trailing tool-result note outweighs the system prompt, so
the note contradicting the prompt looked like the cause. It was tested, and the evidence
for it is real but moderate (decision 2).

**The fetch's own cut.** Found while building the eval fixture, and confirmed against the
real page: `methods.html` is 303,698 characters and puts Appendix F, the section with the
exact 0.8 / 0.98 / 0.95 thresholds, at about character 230,500. `fetch_page` returns at
most `FETCHED_PAGE_CHAR_LIMIT` (20,000) characters. So even a model that always fetched
could not reach the section: the same "know it exists, can't see it" shape ADR 0005 and
0006 fixed for the tab page, recurring on the one path that never got that treatment.

## Decision

**1. A cut fetch is reachable with `search_page`**, the same tool and mental model ADR
0006 built for a cut tab page. Not a second tool, and not a raised limit.

- `extractTavily` ([tavily/client.ts](../../src/background/tavily/client.ts)) stops
  truncating and returns the whole text. The cut moves to `runTool`'s `fetch_page` branch
  in [agentLoop.ts](../../src/background/handlers/agentLoop.ts), using the same
  `truncate()` the tab page's head/full split uses.
- `LoopState.fetchedFullContent` holds the whole text of the most recent *cut* fetch,
  set and never cleared, turn-scoped like the rest of the state (ADR 0004's "turn scope
  is the simplest thing that is clearly safe").
- Once it is set, `SEARCH_PAGE_TOOL` is offered for the rest of the turn even where the
  tab page alone would not offer it. It is added per round next to the `forced` /
  `quoteNudge` logic, not by changing `toolsFor()`, so `citeEnabled`'s cut/whole wording
  stays pinned to the tab page.
- `search_page` searches that text in preference to the tab page's. **A cut fetch wins
  over a cut tab page in the same turn**: it is the most recent thing the model asked to
  read. An accepted edge case, not solved.
- A cut fetch's result carries `FETCH_NOTE_CUT(charsOmitted)`, which names the cut and
  points at `search_page`. It is shown whether or not `cite_page` is on offer, unlike
  `FETCH_NOTE`: it is the only place the model learns the fetch was incomplete.

**Rejected: raise `FETCHED_PAGE_CHAR_LIMIT`.** ADR 0006 measured that the model cannot
reliably find something in a long head either; that is why `search_page` exists for the
tab page instead of a bigger `TRUNCATION_CHAR_LIMIT`. The argument carries over unchanged.

**A gap in the plan, found reading the handler.** `search_page`'s result told the model
*"cite_page can check them"*. That is true of the tab page's text and never true of
fetched text: `cite_page` checks `quotable`, the tab page. A search of a cut fetch would
have told the model to cite something that can never verify, then the round cap's forced
round, which runs no tool, would have ended in *"The model kept searching instead of
answering"* (from reading the loop; never observed, since the note was fixed first). The
fetched path has its own notes, `PAGE_SEARCH_NOTE_FETCHED` and
`PAGE_SEARCH_EMPTY_NOTE_FETCHED`, in the shape of `SEARCH_NOTE` (answer, or search
again). Fetched passages are also kept out of `passageTexts`, so they can never earn the
`page` label.

**Explicitly not done: `cite_page` for fetched or searched content.** ADR 0005 scoped
verification to page content on purpose; extending it to the web path is a rebuild of
that ADR, not part of this issue.

**2. `SEARCH_NOTE` names `fetch_page`.** The issue's proposed fix, and the one wording
change here that reworks an existing note: *"If a snippet has the answer, use it now. If
none does, call fetch_page with that result's URL to read it in full, or search again
with a better query."* The old text ended *"Answer from them now, or search again."*

Its evidence is moderate, and it is kept on that basis. In a concurrent A/B on the real
page (below), given a search with a round left to read in, the page was read in 16 of 17
runs with the new wording and 10 of 14 with the old (p = 0.15); pooled with every other
run of the same code, 30 of 31 against 21 of 26 (p = 0.08). The A/B and the sequential
batches either side of it point the same way, there is a plausible mechanism (the note is
the last thing read before the next call, ADR 0005), and the cost of being wrong is one
sentence. It is not conclusive, and ADR 0006's standard for a note ("not adopted without
an effect") is only just met. It is its own commit so that dropping it is a `git revert`.

Two earlier looks had found nothing, and neither could have: `main` read the page 6 of 6
times in a batch of 10, which is the ceiling, and the spike's `snippet:partial` case (a
snippet that *half*-answers the question) read the page 5 of 12 times on both wordings,
which is a different situation from a snippet with nothing in it. The rewording moves the
second one.

What else was added is one sentence in the three prompt branches that mention
`fetch_page`, *"If that page comes back cut off too, call search_page to reach the rest of
it."* It belongs to decision 1: it tells the model what to do with a cut result, next to
the note that tells it the result was cut.

## Verification

Nemotron 3 Nano throughout, live, 2026-09-28. Unit tests fake the model.

### Unit tests and parity

`npm test`: 288 pass, 8 of them new (280 on `main`). New coverage in `agentLoop.test.ts`
and `spikeParity.test.ts`: the cut and the kept text; `search_page` offered afterwards on
a whole tab page and with no `cite_page` at all; `cite_page` staying the plain variant; the
not-citable notes; a `cite_page` on fetched text still rejected; the priority rule.
`spikeParity.test.ts` checks every new string and `FETCH_NOTE_CUT` against
`scripts/test-nebius-tools.mjs`. Three older assertions ("the prompt never says
`search_page` / `cut off` on a whole page") were too broad once the fetch clause existed
and were narrowed to the tab-page wording they meant.

### Spike (`npm run test:tools`, fictional site)

- `fetch`, a thin snippet: 3 of 3 read the page, with the reworded note and with the old.
- `fetch:cut`, a help page padded past the fetch limit. With the reworded note, 3 runs: one
  endpoint timeout; of the two that completed, one went `fetch_page` (cut), `search_page`,
  and answered with the number that was only past the cut, and the other re-ran
  `search_site` instead of `search_page` and the forced round abstained. With the old note,
  3 runs: two went the first way and one the second. Too few to tell the wordings apart;
  what it shows is a failure shape, the model re-searching the site after a cut fetch
  although `FETCH_NOTE_CUT` tells it to call `search_page`.
- `snippet:partial` (opt-in): a snippet that half-answers the question, the shape #7
  describes. 12 runs each on `main`'s wording and on this branch's, run concurrently: the
  model read the page **5 of 12 on both**, and answered from the snippet 7 of 12 on both.
  None of those 14 snippet answers stated a fact only the page holds (the comments and
  views it scores, the 30 days, 0.87, the 3 days' notice): they answered at the level the
  snippet supports. That is a different situation from the eval's snippet with nothing in
  it, which is where the wordings differ (below). Reproduce with
  `npm run test:tools -- --only=snippet:partial --repeat=12`.

### Eval on the real page (`fetchPageEscalation.eval.ts`)

The biology page is the tab page as in the incident: cut at 120K, the rest kept, so
`cite_page` and `search_page` are on offer from the first round. `search_site` returns a
thin snippet for the methods paper and `fetch_page` returns its real text, captured with
Readability 0.6.0 as ADR 0007 did (303,698 characters; the three thresholds within about 700
characters of each other, past both the 20K and 120K cuts). The question is "What
exact thresholds does the companion methods paper use when pruning nodes and edges from an
attribution graph?" The issue's own wording is a separate, telemetry-only case (below).

| | `main`, 10 runs | this branch, 35 runs |
|---|---|---|
| searched the site | 6 | 25 |
| read the page | 6 | 24 |
| ...given a search with a round left | 6 of 6 | 24 of 24 |
| `search_page` after reading | 4, of the *tab page* | 17, of the fetched text |
| all three thresholds in the answer | 0 | 4 |

The branch column is three single-process batches (10, 10 and 15 runs) of the code as it
ships; `main`'s is one batch of 10. `main` cannot retrieve the thresholds: its fetch is cut
at 20K, and the biology page's own 0.8, 98 % and 95 % are figures from unrelated
probability tables. The branch reached them in 4 of 35 runs and searched the right
document in 17, which is what decision 1 changes.

Which query the model wrote decided the last stage. Across all 39 live `search_page` calls
on the fetched text (98 valid runs, either wording of the note), the 18 whose query held a
pruning word and "threshold" ("pruning threshold" 9 times, "pruning thresholds" 7) led to an
answer with all three numbers 12 times, and with at least one 18 times. The other 21 (the
bare word "threshold" 13 times, the section's title from the table of contents, "graph
pruning", 5, "prune" twice, "pruning" once) led to all three twice, and to at least one 18
times. That matches a free local run of `searchPage` over the same text: "pruning" and
"graph pruning" return none of the numbers, "node pruning threshold" returns all three;
over 16 plausible queries, written by hand and not sampled from the model, the shipped
settings return all three for 9. Changing the settings helps less than choosing the query:
searching only past the cut, 10 of 16; six passages, 11; both, 12. So the last stage is
limited by query choice, the limit ADR 0006 already names ("the model has to pick" the
words), and with three tool rounds spent (`search_site`, `fetch_page`, `search_page`) a miss
has no round left to retry in.

Read the misses, not the count (ADR 0007's lesson, and it applied). The gate first took
only decimals and scored a complete, correct answer as 2 of 3 because it wrote "95 %"; the
paper itself gives the thresholds both ways, so either is accepted now. The counts are also
presence, not attribution: the paper's sensitivity table lists 0.95 as a non-default
pruning threshold and marks 0.8 as the default, and one answer in the last batch gave 0.95
as the default node cutoff, which the gate scores as one of three. So they overstate what
was retrieved. Of the first batch's 8 misses whose answers were read, 7 were honest
("those values are listed only in the cut-off appendix that was not fetched") and 1 partly
invented: it gave the default 0.8 correctly and then said edges use "the same 0.8 cutoff",
where the paper says 0.98. Of the 11 web-labelled answers with no threshold in the batch run
with the old note, 10 said the numbers were not in what they had retrieved and 1, which
only searched the site in its last round and so read nothing, said the paper does not state
them. The other batches' answers were skimmed, not graded.

**What is asserted.** Reading the page after a search with a round left is a rate, not an
invariant (40 of 41 with the reworded note, 21 of 26 with the old), so a per-run `expect`
would go red on noise. It is a floor over the batch instead: at least half of the runs
that searched with a round left must have read the page, checked once at least six did. The case gets 3x the repeats (15 by default, ADR
0007's precedent for the case a metric depends on), which puts about ten runs behind the
check; the final batch at the default settings passed it, 10 of 10. The floor sits far
below both rates, so it catches the model no longer reading after a search, not the
difference the note makes. The three thresholds are reported, not asserted: 4 of 35 as a
gate would be red most runs and tell nobody anything, and ADR 0007 calibrates its
expectations to what is measured. Turn them back on when retrieval holds them.

### `SEARCH_NOTE`, A/B on the real page

The same eval file, two processes per wording running at once against one key, 15 runs each
(60 in all). Nebius rate-limited them: 17 runs ended in a 4xx, which the client reports as
*"Request failed — check your API key"*, and are excluded (10 of the old note's 30, 7 of the
reworded's). That is a cost of running them concurrently, not a behaviour of the model; the
eval run alone did not hit it. That leaves 20 and 23 runs:

| | old note | reworded |
|---|---|---|
| runs | 20 | 23 |
| searched the site with a round left to read in | 14 | 17 |
| ...read the page | 10 (71 %) | 16 (94 %) |
| ...never read it | 4 | 1 |
| all three thresholds in the answer | 4 | 6 |

Reading vs not reading is p = 0.15 (Fisher's exact test) on those alone. Pooling every run
of the same code that searched with a round left, which mixes in single-process batches made
hours apart: the old note 21 of 26 (the A/B's 10 of 14 and 11 of 12 in the batch run just
before it), the reworded note 30 of 31 through the A/B (p = 0.08), and 40 of 41 with the
final batch (p = 0.03). Small samples, and the pooled figures were computed after the A/B
came in short of 0.05, which is a reason to discount them: moderate evidence, not proof.
Of the 5 old-note runs that never read the page, 2 ran `search_page` on the tab page and 3
searched the site again; the 1 reworded run searched again.

### What this does not fix: the issue's own question

Asked verbatim, the model almost never searches. In 34 samples with the page retained as
in the incident (20 full eval runs, 14 round-1 probes) 2 called `search_site`; the second,
in the last batch, went on to `fetch_page` and `search_page` and answered from the web.
The reasoning of the ones that did not shows why: the biology page itself says *"we prune
them to their most important components by removing nodes and edges that do not contribute
significantly to the model's output"*, so it decides the tab page covers the question, cites
that real sentence (which verifies, and earns `page`) and answers shallowly. It reads "the
companion methods paper" as this page's methods section. `SEARCH_NOTE` and `FETCH_NOTE_CUT`
only appear after a search, so nothing here can help. Adding *"or when the question asks
about a different page or document than this one, such as a companion or linked paper"* to
the prompt's site-search trigger did not move it (1 of 8 both ways) and did not pull an
on-page question off the page (0 of 6 both ways). This is ADR 0005's "one verified quote is
a floor, not proof", met before any retrieval. It stays a telemetry case
(`fetch-escalation-verbatim`) so a later attempt has a number to move, and it stays open
on #7.

The eval's first attempt left the tab page's text out, which turned `cite_page` off and
let the model answer with no tool at all; that is not the incident's state and its
numbers were discarded. It also showed that a stalled Nebius request hangs for 15 minutes,
because production has no timeout on those calls (flagged as its own task). The eval bounds
its requests at 90 s and reports stalls apart from misses.

### Chrome click-through (2026-09-30)

Real extension, unpacked, real Chrome. The automation (Claude in Chrome) couldn't reach
`chrome://extensions` or a `chrome-extension://` URL directly — it forces an `https://`
scheme onto any URL, so both come back mangled (`https://chrome-extension//...`). Worked
around it by opening the side panel's own page as a plain tab,
`chrome-extension://<id>/src/sidepanel/index.html?tabId=<id>`, the same `?tabId=` scoping
[background/index.ts:24](../../src/background/index.ts#L24) itself uses — a real
`chrome.runtime.connect` session, not the no-unpacked-extension harness (that harness stubs
`chrome.runtime.sendMessage` and doesn't cover this path). The click itself (open the
biology page, click Sift's toolbar icon) needed a human; everything after ran normally.

Three runs, human-executed, live:

| # | query asked | tool path | thresholds | label |
|---|---|---|---|---|
| 1 | issue's exact wording | `search_page` (tab page, "prune") — no `search_site`, no `fetch_page` | 0/3 | unverified |
| 2 | "graph pruning" | `search_site` only | 0/3, one real fact recovered anyway (below) | web |
| 3 | "prune attribution graph" | `search_site` only | 0/3 | unverified |

0/3 read the page (`Reading …` never appeared; run 3 watched specifically for it).
Matches the 2/34 rate already logged above for the verbatim case — not a surprise alone.

Run 2 is the interesting one. Its answer correctly stated that pruning "reduce[s] the
number of nodes by an order of magnitude while reducing completeness by only 20%." Checked
against the real fixture (`src/eval/fixtures/transformerCircuitsMethods.txt`): genuine,
found at character offset 34,128 and again at 148,676 — past both the 20K `fetch_page`
head-cut and, by the step list, anything `search_page` touched, since neither tool ran.
Two readings, can't tell which from what's available: `search_site`'s Tavily snippet for
that query was richer than the "thin snippet" this ADR assumed throughout, or the model
already knows this real, public paper from pretraining and didn't need to read anything.
No network capture from that run to settle it — filed as
[#30](https://github.com/aishahsofea/sift/issues/30) rather than guessed at here, since it
questions this eval fixture's validity as a grounding test (ADR 0007 used a *fictional*
site for the #3 eval for exactly this reason).

ADR 0004's allowlist: still zero real `fetch_page` calls, this session included. Every
number in this ADR before today came from the eval harness or the spike, never the actual
extension.

### Contamination probe (2026-09-30)

Filed as [#30](https://github.com/aishahsofea/sift/issues/30): run 2 above can't tell
"Tavily's snippet was unexpectedly rich" apart from "the model already knows this real,
public paper from pretraining." New file,
[`methodsPaperKnowledgeProbe.eval.ts`](../../src/eval/methodsPaperKnowledgeProbe.eval.ts),
asks the exact Appendix F threshold question with **no retrieval path at all** — an
unrelated fictional page, no `tavilyApiKey`, no `searchResults`/`extractResult`/
`fullContent`, so `search_site`/`fetch_page`/`search_page` are never even offered
(`cite_page` stays offered but can't smuggle in real page text past ADR 0005's quote
check). Any correct threshold in the answer can only come from what the model already
knew.

Three runs, `EVAL_REPEATS=3`, live: 0/3 thresholds landed in every run, each answer a
plain "I don't have that content" refusal. The model does **not** know the Appendix F
thresholds unaided — run 2's real fact came from retrieval (the richer-than-assumed
Tavily snippet), not pretraining. Clean result: the existing fetch-escalation numbers
above stand uncaveated.

### Not run

- Real Tavily extraction. The eval feeds Readability text for the methods paper through a
  mocked `extractTavily`; Tavily has its own extraction, and nothing here has fetched its
  `raw_content` for that URL, so its length and shape, and so where the cut falls, are
  assumed.

## Consequences

- A question that needs an escalated fetch costs up to three tool rounds before the forced
  answer, the same ceiling ADR 0006's cut-page path shares. There is no retry for a
  `search_page` query that misses.
- `extractTavily` no longer bounds what it returns; each caller cuts for itself. There is
  one caller.
- A follow-up that needs the same fetched page re-fetches it: `fetchedFullContent` does not
  outlive the turn, the trade-off ADR 0004 already accepted for the allowlist.
- The `search_page` tool and its notes now branch on what was searched, not only on whether
  anything was found. The notes are mirrored in `scripts/test-nebius-tools.mjs` and drift
  fails `spikeParity.test.ts`.
- Open, and not decided here: the tab page "covering" a question it half-answers (still
  open on #7); how `search_page` over a fetched page should pick its passages, and whether
  a miss should get a retry ([#27](https://github.com/aishahsofea/sift/issues/27)); the
  missing request timeout on Nebius calls
  ([#28](https://github.com/aishahsofea/sift/issues/28)). The numbers above are the
  starting point for each.
- [#30](https://github.com/aishahsofea/sift/issues/30) (closed): the contamination probe
  (see "Contamination probe" under Verification) came back clean — the model can't state
  the Appendix F thresholds with no retrieval path, so a pass on this eval's real-paper
  fixture is retrieval, not pretraining. The fetch-escalation counts above stand
  uncaveated.
- Don't run several eval processes at once against one key: Nebius answers with a 4xx, and
  the client reports it as a key error (17 of the 60 runs in the A/B above).
