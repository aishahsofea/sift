# Sift

A Chrome extension that reads the page you're on and lets you ask questions
about it. Answers come from the page content when it covers the question; when
it doesn't, the model searches the rest of the site with
[Tavily](https://tavily.com) and answers from what it finds.

Built for the Nebius x NVIDIA hackathon. Runs on
[Nebius Token Factory](https://tokenfactory.nebius.com) using an NVIDIA
Nemotron model.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0` (see `.nvmrc` for the version this was
  built against). Vite 8 will fail to start on older Node 20.x with a
  confusing module-loading error rather than a clean version check.
- A [Nebius Token Factory](https://tokenfactory.nebius.com) API key.
- A [Tavily](https://tavily.com) API key, for the site search. Without one Sift
  still answers from the page and says so when the page doesn't cover the
  question.

## Setup

```bash
npm install
npm run build
```

This runs two separate Vite builds (the extension shell, and the content
script — see the "two Vite configs" note in [PLAN.md](PLAN.md) for why) and
produces a `dist/` directory.

## Load the extension in Chrome

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

Pages longer than 120,000 characters are cut short. The panel says so before you
ask anything, and again on each answer given against a cut page. The model is
told how many characters it can't see and to search for anything past the cut,
and an answer on a cut page with no search behind it is labeled **not checked**,
since the model only held a fragment of the page. The quote step is skipped on a
cut page: a quote from the part the model saw can't show the answer wasn't about
the part it didn't.

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
                    # (--no-cite runs it without cite_page, the baseline for that round's cost)
```

## Project layout and design decisions

See [PLAN.md](PLAN.md) for the full phase-by-phase build plan, the fixed
product decisions, and the permission/message-passing gotchas this extension
works around.

Architecture decisions made since that plan are recorded in
[docs/adr/](docs/adr/).

## License

MIT — see [LICENSE](./LICENSE).
