# Sift

A Chrome extension that reads the page you're on and lets you ask questions
about it. Answers come from the page content first; if the answer isn't
there, it automatically falls back to a [Tavily](https://tavily.com) web
search scoped to the current site.

Built for the Nebius x NVIDIA hackathon. Runs on
[Nebius Token Factory](https://tokenfactory.nebius.com) using an NVIDIA
Nemotron model.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0` (see `.nvmrc` for the version this was
  built against). Vite 8 will fail to start on older Node 20.x with a
  confusing module-loading error rather than a clean version check.
- A [Nebius Token Factory](https://tokenfactory.nebius.com) API key.
- A [Tavily](https://tavily.com) API key.

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
Sift first tries to answer from the page's own content; if the model reports
the answer isn't on the page, it automatically searches the web (scoped to
the current site's domain) and streams a prose answer instead. Pages that
can't be read (e.g. `chrome://` pages, the built-in PDF viewer) show a
disabled "Can't read this page" state rather than a raw error.

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
```

## Project layout and design decisions

See [PLAN.md](PLAN.md) for the full phase-by-phase build plan, the fixed
product decisions, and the permission/message-passing gotchas this extension
works around.

## License

MIT — see [LICENSE](./LICENSE).
