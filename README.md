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
3. No setup needed: the release build uses a shared demo server for the model and
   search, with daily limits. (Optional: under **Details → Extension options**, add
   your own Nebius and Tavily keys to call them directly. Page text and questions
   pass through the demo server only while a key is blank.)
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
Answers stream in as they're written.

### Where answers come from

The model decides whether the page answers your question. If it doesn't, the
model searches the current site.

- It writes its own query, so "what else have they written?" is searched under
  the author's name, not the pronoun.
- It can open a full result page when a snippet isn't enough.
- It gets three rounds of searching, then answers with what it has.
- The panel names each search as it runs.

### Answer labels

Every answer is labeled from what actually happened, not from what the model
says it did.

| Label | Meaning |
| --- | --- |
| **from the page** | The model quoted the page, and at least one quote was found word for word in the page text. |
| **from the web** | A search returned something. |
| **from the page and the web** | Both of the above. |
| **not checked** (grey) | Nothing ties the answer to the page. This is not the same as wrong. |

The chip says how many quotes were checked, not that the answer was: one
verified quote shows the page was quoted, not that every claim is on it.

To answer from the page, the model must first quote it. Sift checks each quote
against the page text in code, not with a model. An answer written without
quoting is thrown away, and the model is asked once to quote first. Each
answer logs one line to the service worker console saying why it got its
label. Details are in
[ADR 0005](docs/adr/0005-grounding-is-verified-not-assumed.md).

### Long pages

Only the first 120,000 characters of a page go into the prompt. The panel says
a page is long before you ask anything.

- Up to 1,000,000 characters, Sift keeps the whole page in the browser's
  session storage. The model can search it for the passages it needs. This runs
  inside the extension, with no extra request and no Tavily key.
- On a long page, **from the page** needs a quote from a passage that search
  returned. Otherwise the label is **not checked**, because a quote from the
  part the model was given can't show the answer wasn't about the part it
  wasn't.
- Past 1,000,000 characters, or if the browser has no room to keep the text,
  the model sees only the start and there is no quote step. The panel says the
  rest wasn't read.

See [ADR 0006](docs/adr/0006-long-pages-are-kept-and-searched-locally.md).

### Unreadable pages

Pages Sift can't read, such as `chrome://` pages and the built-in PDF viewer,
show a disabled "Can't read this page" state instead of a raw error.

### How it works

Earlier versions had Sift decide when to search. Now the model does. The
reasoning is in [ADR 0001](docs/adr/0001-model-driven-agent-loop.md).

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
