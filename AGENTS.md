# AGENTS.md

Guidance for AI coding agents working in this repo.

## Project

Sift — Chrome extension. Reads the current page, answers questions about it.
Answers come from page content first; falls back to a Tavily search scoped to
the current site when the answer isn't on the page.

Backend: [Nebius Token Factory](https://tokenfactory.nebius.com), an NVIDIA
Nemotron model.

Status: early development. No extension code yet (no manifest, content
script, background, or popup) — just a Day-1 API sanity script.

## Commands

- `npm run test:nebius` — sanity-checks the Nebius Token Factory + Nemotron
  round trip (lists available models, runs one chat completion). Requires
  `.env` with `NEBIUS_API_KEY`.

## Environment

- Copy `.env.example` to `.env` and fill in values.
- `NEBIUS_API_KEY` — required, used for all Nebius Token Factory calls.
- `TAVILY_API_KEY` — for the search fallback; not yet wired into any code.
- `.env` is gitignored. Never commit real keys.

## Structure

- `scripts/` — standalone Node scripts (ESM), run via `node
  --env-file=.env scripts/<name>.mjs`.
- No `src/` yet — extension scaffolding (manifest.json, content script,
  background/service worker, popup UI) hasn't been added.

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

## License

MIT — see [LICENSE](./LICENSE).
