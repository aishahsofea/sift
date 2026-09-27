# AGENTS.md

Guidance for AI coding agents working in this repo.

## Project

Sift — Chrome extension. Reads the current page, answers questions about it.
The model works from the extracted page text and decides for itself when to
reach for a Tavily search scoped to the current site. On a page too long for the
prompt it can also search the rest of the page, locally
([ADR 0006](docs/adr/0006-long-pages-are-kept-and-searched-locally.md)).

Backend: [Nebius Token Factory](https://tokenfactory.nebius.com), an NVIDIA
Nemotron model.

Status: working extension, loadable unpacked from `dist/`. Manifest V3,
React 19, Vite 8 + `@crxjs/vite-plugin`. The UI is a side panel (not a popup)
plus an options page for API keys. The chat pipeline is a model-driven agent
loop — the model decides when to search; see
[ADR 0001](docs/adr/0001-model-driven-agent-loop.md).

## Commands

- `npm run build` — two Vite builds (extension shell, then content script)
  into `dist/`. They're separate because Chrome won't load ES modules in a
  content script; see PLAN.md.
- `npm run dev` — extension shell with HMR. `npm run dev:content` — content
  script watcher, needs its own terminal. Run both during development.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run test` — `vitest run`. Unit tests cover pure logic, plus the agent loop
  with the model, Tavily and `chrome.storage` faked (`agentLoop.test.ts`). Anything
  that needs a real `chrome.*` isn't tested here.
- `npm run test:nebius` — sanity-checks the Nebius Token Factory + Nemotron
  round trip (lists available models, runs one chat completion). Requires
  `.env` with `NEBIUS_API_KEY`.
- `npm run test:tools` — live spike for native tool calling on Nemotron
  (stubbed `search_site`/`fetch_page` tools, no Tavily calls), for the
  `cite_page` quote check, and for `search_page` on a cut-short page
  (`--only=cut`). Pass model IDs to compare models, `--only=<case-id>`
  to rerun one case (or a group like `force` or `cite`), `--repeat=<n>` to gauge
  flaky behavior, `--no-cite` for the pre-`cite_page` baseline its cost is
  measured against. It keeps its own copy of the prompt and tool definitions, so
  a change to `src/background/nebius/{promptAssembly,tools}.ts` wording needs the
  same change here and a re-run. Requires `.env` with `NEBIUS_API_KEY`.

## Environment

- Node `^20.19.0` or `>=22.12.0` (`.nvmrc` pins what this was built against).
  Vite 8 fails on older Node 20.x with a confusing module-loading error.
- The extension reads its keys from `chrome.storage.local`, entered through
  the options page — see `src/background/keys.ts`. It never reads `.env`.
- `.env` is only for the `scripts/` sanity checks. Copy `.env.example` and
  fill in `NEBIUS_API_KEY`; `TAVILY_API_KEY` is there for future scripts,
  nothing under `scripts/` calls Tavily yet.
- `.env` is gitignored. Never commit real keys.

## Structure

- `src/background/` — service worker. `handlers/` holds the agent loop, page
  extraction, answer labelling, `cite_page` quote verification and the local
  `search_page` scan, `nebius/` the client plus prompt assembly and tool schema,
  `tavily/` the site-scoped search, `history/` per-tab session storage (history,
  the extracted page, and the whole text of a page too long for the prompt).
- `src/content/` — content script, extracts readable page text via
  `@mozilla/readability`, plus the byline Readability leaves behind
  (`byline.ts`).
- `src/sidepanel/` — React side panel (the main UI). `src/options/` — React
  options page for API keys.
- `src/shared/` — types, message contracts, storage keys, and constants
  (`MAX_TOOL_ROUNDS`, truncation limits) used by both sides.
- `scripts/` — standalone Node scripts (ESM), run via `node
  --env-file=.env scripts/<name>.mjs`. Not part of the extension build.
- `manifest.config.ts` — manifest generated at build time from
  `package.json`. `vite.config.ts` builds the shell,
  `vite.content.config.ts` the content script.

## Conventions

- Work on feature branches, not `main`. Branch per feature/fix (e.g.
  `feature/markdown-message-rendering`), open a PR into `main` when done.
- ESM only (`"type": "module"` in package.json).
- Scripts read secrets from `process.env` via Node's `--env-file` flag —
  no `dotenv` dependency.
- Discover Nemotron model IDs from `GET /v1/models` rather than hardcoding
  one; try a preferred-candidates list first, fall back to the first
  Nemotron match. See `scripts/test-nebius.mjs`.
- Nebius chat responses may return reasoning/chain-of-thought under
  `message.reasoning` instead of the OpenAI-style `message.reasoning_content`,
  depending on model/wrapper — check both fields.

## Issues

Work gets tracked as GitHub issues in [aishahsofea/sift](https://github.com/aishahsofea/sift/issues),
so the issue list doubles as the record of what's been done.

- Open an issue **before** starting work that's significant — more than one
  commit, changes behaviour a user would notice, adds a dependency, or is
  something we'd want to find again in three months. Skip it for typos,
  formatting, and one-line fixes.
- If work starts small and grows, open the issue as soon as that's clear
  rather than after the fact.
- `gh issue create --title "..." --body "..." --label <label>`. Labels are the
  GitHub defaults (`bug`, `enhancement`, `documentation`); add new ones only
  when a batch of issues needs them.
- The body says what and why, and how we'll know it's done. Link the relevant
  ADR or PLAN.md row when one exists.
- Name the branch after the issue's subject, then put `Closes #<n>` in the PR
  body so merging closes the issue.

## Decisions

Architecture decisions live in [docs/adr/](docs/adr/) — read the index there
before changing the chat pipeline, the model choice, or how tools are called.
Pre-plan product decisions stay in [PLAN.md](PLAN.md); an ADR that contradicts
a PLAN.md row says so explicitly. Add a record when a decision changes the
architecture rather than burying it in a commit message.

## License

MIT — see [LICENSE](./LICENSE).
