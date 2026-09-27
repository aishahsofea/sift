# 6. Long pages are kept whole and searched locally, not truncated

- Status: proposed
- Date: 2026-09-27
- Supersedes: the "Context/truncation" row of the locked decision table in
  [PLAN.md](../../PLAN.md) ("No chunking… defensive char-cap truncation only")
- Related: [ADR 0001](0001-model-driven-agent-loop.md),
  [ADR 0005](0005-grounding-is-verified-not-assumed.md),
  [ADR 0007](0007-grounding-eval-set.md)
- Built: #11. Still `proposed`: #3 ([ADR 0007](0007-grounding-eval-set.md)) now exists
  and answers most of "Still owed to #3" below, but the extension still has not been
  click-tested in Chrome, which this record's own "Done when" leaves open.

## Context

[ADR 0005](0005-grounding-is-verified-not-assumed.md) found the root cause of #5:
`truncate()` keeps the first 120,000 characters of a page and drops the rest, so on a
long page the model can hold a heading and a summary for a section whose body was
cut. #12 made that visible and capped the label, #10 added `cite_page`, and both left
the user without an answer: the text that answers the question was never sent. ADR
0005 said where the fix goes (keep the whole page, search it locally). This record is
what was built, what was measured, and the choices the issue left open.

## Decision

**1. Keep the whole text, apart from the page.** For a page cut short, the content
script sends the whole text next to the page. The background stores it in
`chrome.storage.session` under its own key (`sift:fulltext:<tab>`), so reading the
page for each question does not also read the megabyte the model rarely needs, and
sets `ExtractedPage.searchable`. Details that matter:

- All or nothing. A page over `RETAINED_PAGE_CHAR_LIMIT` (1,000,000 characters) is not
  kept and is handled as before #11: the model sees the head, there is no quote step,
  and the panel says the rest wasn't read. A second, partial cut would be one that
  `search_page` could not explain to the model.
- Storing can fail (the session quota is 10 MB across every tab). That falls back to
  storing the head alone, unsearchable, instead of failing the extraction. A new page
  also removes the tab's previous text, which would otherwise be searched as the new
  page's.
- A tab that closes takes its page, text and history with it (`chrome.tabs.onRemoved`,
  no `tabs` permission). Tab ids are not reused, so nothing else ever removed them, and
  a whole page is far more than the head that used to be kept. This goes beyond what
  the issue asked for and is easy to drop.

**2. The prompt is unchanged in shape.** Only the head goes in, and the system prompt is
the same on every round and every question for a page, so the cached prefix that ADR
0001 depends on survives. The truncation notice says how much is cut and names
`search_page` as the way to reach it.

**3. `search_page(query)` is a local keyword search of the whole page.** BM25 over
1,500-character windows that start every 750, so each character is in two windows and a
sentence on one window's edge is whole in its neighbour. It returns at most four
non-overlapping passages, best first, each with the character offset it starts at.
Choices the issue left open:

- Windows, not sentences or paragraphs. Readability's `textContent` has no dependable
  paragraph breaks: it runs blocks together whenever the source markup has no
  whitespace between them.
- A word counts in a window only if all of it is there. Otherwise a match on a window's
  edge scored, then was cut from the passage shown, which could come back with no match
  in it, or empty.
- A crude stemmer (drop a plural s, keep six letters) so "jailbreaks" finds "jailbreak".
  It merges "transformer" with "transfer", which costs a stray passage where a miss
  costs a round.
- It searches the whole page, not only the part past the cut, with two of the four slots
  held for the part past it. The first version searched only past the cut, on the
  reasoning that the head is in the prompt already. On a real page that was wrong: a
  question the head answered, but that the model could not find in 40,000 tokens of
  head, got weak passages from past the cut, and a search of the whole page would have
  returned the right one. The two held slots stop a head that says a word often from
  filling every slot and hiding the section the tool is there to reach.
- Local and free. It runs in about 6 ms on a 178,442-character page. No request, no
  embeddings, no new dependency, and it is offered with no Tavily key.
- Scripts written without spaces match only whole runs of characters. CJK pages are not
  searchable in any useful way.

**4. Offered only on a cut page.** The issue leaned towards offering it on long pages
that were not cut too. It is not: the whole text is in the prompt there, so a search
adds a round without adding text, and ADR 0005 found that a tool on offer gets used.
What would change this is #3 showing the model missing things in a long whole page.

**5. `cite_page` checks quotes against the whole page, and is offered on a cut page.**
That lifts ADR 0005's "a cut page skips the tool". The wording for a cut page is kept
apart from the wording verified for whole pages: a cut-page tool description (a
`search_page` passage can be cited, `search_site` and `fetch_page` results cannot), a
cut-page nudge that includes searching as a way out, and a cut-page system prompt. The
whole-page text is byte for byte what ADR 0005 verified.

**6. The label on a cut page rests on a quote taken from what the search returned.**
`page` needs a verified quote that is inside a passage `search_page` returned. Without
one it is `unverified` (or `web`). The obvious weaker rule, "the model searched", let a
model search, ignore the results, quote the head summary and get `page`, which is #5
with an extra step. Two smaller consequences:

- `ChatTurn.truncated` now means the model never searched the page, not that the page
  was cut. An answer whose model searched, even to no result, does not carry the "page
  was cut off: N characters weren't read" line, because they were looked through.
- An answer written after only `search_page` calls still needs a quote, so it is
  discarded and the model asked once, like any other uncited page answer. After a search
  that found nothing it is not asked: no passage exists that a quote could lift the label
  with.

**7. The panel.** A step line ("Searching this page for “…”") and a banner that says a
long page is searched rather than unread. The banner keeps its old wording where the
rest was not kept.

## Verification

Unit tests use a faked model, Tavily and `chrome.storage`; the live checks below are the
real Nebius endpoint on Nemotron 3 Nano. Nothing here ran inside Chrome.

### Fixture cases (2026-09-27)

`npm run test:tools -- --only=cut`. A fictional postmortem: the head has a table of
contents entry and a summary sentence for section 5, and section 5 (a drifted clock, an
expired lock, fencing tokens) is past the cut, so no answer is knowable from memory.
Final design, 3 runs per case:

| Case | Result |
|---|---|
| Question about the section (with a Tavily key) | 3 of 3 searched, quoted from past the cut, answered from it; `page` |
| Same, no Tavily key | 3 of 3 |
| Question the head answers | 3 of 3 answered with no search, so `unverified` |
| Question neither part covers | 3 of 3 abstained, no invented figure |
| Model answers with no tool at all first | 3 of 3 thrown away, then searched and quoted; `page` |
| Section question plus a site search in one | 0 of 3 |
| Section question on a 120,000-character head | 2 of 3 |

The failures in the last two are one behaviour. The model quoted the head's summary
sentence and answered from it without searching: in all three mixed-question runs and in
one of the three big-head runs. The label is what catches it: those answers are not `page`. But the
answer is the short one from the summary, which is the part of #5 this does not fix.
Cost, mean over runs: a section question is 3 rounds and about 16 s (17 s on the big
head); a head question is 2 rounds and about 6 s. Whole-page questions on the same
fixture were 1.3 to 2.6 s before `cite_page` (ADR 0005).

How the design got there, since the numbers moved:

| Design | Section | Head, no search | Mixed | 120K head |
|---|---|---|---|---|
| Search only past the cut (7 runs) | 7 of 7 | 7 of 7 | 3 of 7 | 2 of 2 |
| Whole page, two held slots (3 runs) | 3 of 3 | 3 of 3 | 0 of 3 | 2 of 3 |
| The same plus a note on `cite_page`'s result telling the model to search if its quotes only name or summarize a section (5 runs) | 5 of 5 | 5 of 5 | 1 of 5 | 4 of 5 |

The note was dropped. Samples this small cannot separate 0 of 3 from 1 of 5, and it did
not change the mixed question, which is the case it was for. Not adopted without an
effect.

### The prefix cache

On the 120,000-character head, prompt tokens cached per round, across three runs and
three rounds each: 38,016 of 42,143, 38,016 of 42,464, 42,240 of 42,671 (and the same
shape in the other runs), so 90 to 99 percent of the prompt from round 2 on. ADR 0001
measured 21,120 of 23,454 (90 percent) on a 100,000-character page. Unchanged. A unit
test also asserts the system message is identical on every round.

### A real page (2026-09-27)

`transformer-circuits.pub/2025/attribution-graphs/biology.html`, the page from #5,
fetched with curl and its text taken with `get_text('')` (178,442 characters), through
the real `runAgentLoop` and the real API with no Tavily key. Two things differ from #5.
The copy is not the one Chrome extracted then, and the jailbreak section starts between
83,000 and 85,000 characters in both this text and the text the built content script
produced in a real browser (Readability, 158,920 characters: 120,000 head, 38,920 omitted, head a
prefix of the whole). So the jailbreak body is inside the head here, and sections past
120,000 characters (the Discussion, the closing "Questions Re:" lists) stand in for it.

| Question | `main` | This branch |
|---|---|---|
| What does the Discussion say about parallel mechanisms and modularity? | No tools, `unverified`, 12 s. Talks about the Dallas and Texas super-nodes, which are from the introduction | `search_page`, quotes verified from the Discussion, `page`, 23 s |
| What future research questions does the paper propose about multi-step reasoning? | No tools, `unverified`, 12 s. A list of directions that is not the paper's | `search_page`, three verified quotes from the passages, the paper's three questions, `page`, 17 s |
| How does the jailbreak the paper analyses work? (answer is in the head) | Not run | No search, head quotes, `unverified` with the cut noted, 44 s |

The first version of the search (past the cut only) answered the jailbreak question from
tangential passages past the cut, labelled `page`: the reason for the change in
decision 3. The label rule in decision 6 came from the same run. Also seen once, and not
handled: an answer that ended with text imitating a `cite_page` call.

### Done when, from the issue

- The whole text is retained and reachable with only the head in the prompt, and the
  cached prefix is unchanged: yes, above.
- `search_page` returns ranked passages with offsets from text past the limit: yes.
- The #5 question on the #5 page is answered from the page, grounded, with the
  previously unreachable section cited: on the stand-in questions above, yes; the exact
  #5 shape could not be reproduced from this copy of the page.
- The tool is available with no Tavily key: yes, every real-page run above had none.

### Still owed to #3 — mostly answered by [ADR 0007](0007-grounding-eval-set.md)

- **How often an ungrounded answer is labelled `page`, which has to be 0.** Measured on
  the real #5 page, 3 live batches of 15: 0 of 32 `page`/`page+web`-labelled answers
  showed no sign of the real mechanism.
- **How often the model quotes a summary and never searches, on more questions and
  pages than one fixture.** Measured on a false-abstention question on this real page
  (3 batches of 5): 12 of 15 runs correctly answered from the head with no search and
  were labelled `unverified` anyway — this rule's own cost, not a bug — and 3 of 15
  searched despite the head already answering. Still one real page and one question,
  not "more."
- **False abstention on a cut page.** 15 of 15 runs gave a substantive, verified-quote
  answer; 0 true abstentions.
- **Quote pass rates on more real pages, and the same on more than one model.** Not
  answered — one real page, one model. Tracked as #22 rather than folded into #3.
- **A click-through in Chrome: storage quota behaviour, a very long page, the banner.**
  Still not done. This is what keeps this record `proposed`.

## Consequences

- A section question on a long page takes three rounds, a search, a quote and an answer,
  where it was one round that gave an invented answer. 16 to 44 s in the runs above,
  and endpoint latency swung by several times between runs.
- A question the head answers is still `unverified` ("not checked · page was cut
  short") unless the model happens to search: a quote from the head cannot show the
  answer wasn't about the part that was cut. That is #12's cost carried forward, and the
  ways round it (offer the search on whole pages, count head quotes, always search once)
  are open questions for #3, not settled here.
- The label says the model quoted something the search found. It does not say what it
  found is the right thing, or that the answer follows from it.
- Search is keyword search: no synonyms, and it needs words that are on the page. The
  model has to pick them. On the real page it did ("parallel mechanisms", "future
  multi-step reasoning").
- `chrome.storage.session` now holds up to a megabyte per long page. All or nothing at
  1,000,000 characters, a fallback when storing fails, and cleanup on tab close keep
  that bounded, but a browser with many long tabs open can still run out, and the page is
  then handled as before.
