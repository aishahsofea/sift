# Sift

A Chrome extension that reads the page you're on and lets you ask questions
about it. Answers come from the page content when it covers the question; when
it doesn't, the model searches the rest of the site with
[Tavily](https://tavily.com) and answers from what it finds.

Built for the Nebius x NVIDIA hackathon. Runs on
[Nebius Token Factory](https://tokenfactory.nebius.com) using an NVIDIA
Nemotron model.

## Try it (no build needed)

1. Download `sift-extension.zip` from the
   [latest release](https://github.com/aishahsofea/sift/releases/latest) and unzip it.
2. Go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**
   and select the unzipped folder.
3. Open the extension's **Details → Extension options**, enter a Nebius and a
   Tavily API key, and **Save**. Hackathon judges: the keys are in the private
   testing instructions on the Devpost submission.
4. Open any `http(s)://` page and click the Sift toolbar icon to ask a question.

## How it uses Nebius and NVIDIA

- **NVIDIA Nemotron** (an open-source NVIDIA model) does all the reasoning:
  deciding whether the page answers the question, calling tools, and writing the
  answer.
- **Nebius Token Factory** serves it, with native tool calling and streaming.
  Every turn is one or more chat completions against it.
- **Tavily** provides the site-scoped search the model reaches for when the page
  doesn't cover the question.

## Build from source

### Requirements

- Node.js `^20.19.0` or `>=22.12.0` (see `.nvmrc` for the version this was
  built against). Vite 8 will fail to start on older Node 20.x with a
  confusing module-loading error rather than a clean version check.
- A [Nebius Token Factory](https://tokenfactory.nebius.com) API key.
- A [Tavily](https://tavily.com) API key, for the site search. Without one Sift
  still answers from the page and says so when the page doesn't cover the
  question.

### Setup

```bash
npm install
npm run build
```

This runs two separate Vite builds (the extension shell, and the content
script — see the "two Vite configs" note in [PLAN.md](PLAN.md) for why) and
produces a `dist/` directory.

### Load the extension in Chrome

1. Go to `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` directory.
4. Click the Sift toolbar icon to open the side panel.
5. Open the extension's **Details → Extension options** and enter your
   Nebius and Tavily API keys, then **Save**. Keys are stored in
   `chrome.storage.local` and never leave the browser except in requests to
   Nebius/Tavily themselves.

## Using it

Open any regular `http(s)://` page, then ask a question in the side panel.

The model decides for itself whether the page answers the question. When it
doesn't, it searches the current site — writing its own query, so a follow-up
like "what else have they written?" is searched under the author's name rather
than the pronoun — and can pull up a full result page when a snippet isn't
enough. It gets three rounds of that before it has to answer with whatever it
has. The side panel names each search as it runs, and every answer is labeled
from what actually happened, not from what the model says it did: **from the
web** when a search returned something, **from the page** when the model quoted
the page before answering and at least one quote was found word for word in the
page text, **from the page and the web** when both hold, and a grey **not
checked** when nothing ties the answer to the page (see below).

Answering from the page takes an extra round: the model calls `cite_page` with
up to three short passages that support its answer, and Sift checks each one
against the page text in code, not by asking a model. A quote that isn't there
comes back to the model as an error to correct; once one is found, the model is
told to answer, and any quote that wasn't found is left out of the answer. An
answer written without calling `cite_page` is thrown away unseen and the model is
asked once to quote first. The chip says how many quotes were checked, not that
the answer was, because one verified quote shows the page was quoted and not that
every claim in the answer is on it. An answer with no verified quote is
**not checked**, which is not the same as wrong. Each answer also logs one line to
the service worker console saying why it got its label. See
[ADR 0005](docs/adr/0005-grounding-is-verified-not-assumed.md).

Only the first 120,000 characters of a page go into the prompt. For a longer page
(up to 1,000,000 characters) Sift keeps the whole text in the browser's session
storage and gives the model a `search_page` tool. It looks through the whole page
for the words the model asks for and returns the best-matching passages with where
they start, and it reserves room in every result for the part the prompt doesn't
hold. It runs inside the extension, so it needs no request, no embeddings and no
Tavily key. The panel says a page is long before you ask anything, and the model is
told how many characters it can't see and to search for a section the prompt only
names or summarizes. A quote is checked against the whole page. An answer on a long
page is labeled **from the page** only when a quote came from a passage
`search_page` returned; if the model never searched, or quoted something else, the
label is a grey **not checked**, since a quote from the part it was given can't show
the answer wasn't about the part it wasn't. Past 1,000,000 characters, or if the
browser has no room to keep the text, the page is handled as it used to be: the
model only sees the start, there is no quote step, and the panel says the rest
wasn't read. See [ADR 0006](docs/adr/0006-long-pages-are-kept-and-searched-locally.md).

Answers stream as they're written. Pages that can't be read (e.g. `chrome://`
pages, the built-in PDF viewer) show a disabled "Can't read this page" state
rather than a raw error.

How this works, and why it replaced an earlier version where *Sift* rather than
the model decided when to search, is recorded in
[ADR 0001](docs/adr/0001-model-driven-agent-loop.md).

## Development

```bash
npm run dev          # extension shell (background/side panel/options), with HMR
npm run dev:content  # content script, in a separate terminal — see PLAN.md
```

Chrome doesn't support ES modules in an injected/content-script context, so
the content script builds separately from everything else; run both watchers
side by side during development, then reload the unpacked extension in
Chrome to pick up background/content-script changes (side panel and options
changes hot-reload).

## Other scripts

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest run — unit tests for pure logic only
npm run test:nebius # scripts/test-nebius.mjs — standalone Nebius API smoke test, reads .env
npm run test:tools  # scripts/test-nebius-tools.mjs — live tool-calling spike for the agent loop, reads .env
                    # (--no-cite runs it without cite_page, the baseline for that round's cost;
                    # --only=cut runs the long-page cases for search_page)
npm run test:eval   # src/eval/*.eval.ts — the grounding regression net (issue #3), reads .env.
                    # Drives the real agent loop against the live API; set EVAL_REPEATS to
                    # change how many times each case repeats (default 5).
```

## Project layout and design decisions

See [PLAN.md](PLAN.md) for the full phase-by-phase build plan, the fixed
product decisions, and the permission/message-passing gotchas this extension
works around.

Architecture decisions made since that plan are recorded in
[docs/adr/](docs/adr/).

## License

MIT — see [LICENSE](./LICENSE).
