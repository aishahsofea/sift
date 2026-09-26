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
web** when a search returned something, **from the page** when the model held
the whole page and searched nothing, and an amber **unverified** when an answer
can't be traced to the page (see below).

Pages longer than 120,000 characters are cut short. The panel says so before you
ask anything, and again on each answer given against a cut page. The model is
told how many characters it can't see and to search for anything past the cut,
and an answer on a cut page with no search behind it is labeled **unverified**,
since the model only held a fragment of the page.

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
```

## Project layout and design decisions

See [PLAN.md](PLAN.md) for the full phase-by-phase build plan, the fixed
product decisions, and the permission/message-passing gotchas this extension
works around.

Architecture decisions made since that plan are recorded in
[docs/adr/](docs/adr/).

## License

MIT — see [LICENSE](./LICENSE).
