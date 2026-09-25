# Sift — phased implementation plan

## Context

Sift is a Chrome extension for the Nebius × NVIDIA hackathon: it reads the tab
the user is on and answers questions about it in a chat UI, backed by
Nebius Token Factory (NVIDIA Nemotron), with an automatic Tavily web-search
fallback scoped to the current site when the answer isn't on the page.

The repo currently has no extension code at all — just
[scripts/test-nebius.mjs](scripts/test-nebius.mjs), a Day-1 script confirming
the Nebius API round-trip works. This plan is the from-scratch build:
manifest, content script, background service worker, side panel UI, and
options page.

Every architectural decision below was resolved directly with the user in a
dedicated design interview (not re-litigated here), and the riskiest
technical assumptions were verified empirically against the real Nebius and
Tavily APIs (using the real keys already in `.env`) rather than assumed from
documentation or memory. Where a claim below is marked **(verified)**, it was
confirmed live this session, either against the API or against the local
toolchain — not inferred.

**Scope discipline**: this is a solo hackathon build, demo-only (no Chrome
Web Store submission, no distribution to other machines). Every choice below
is picked for that scope — do not add abstraction, config surface, or
resilience beyond what's listed.

## Fixed product decisions (locked, not open for reconsideration)

> Decisions taken after this plan live in [docs/adr/](docs/adr/). The
> **Fallback trigger** and **Streaming** rows below are superseded by
> [ADR 0001](docs/adr/0001-model-driven-agent-loop.md).

| Area | Decision |
|---|---|
| Key handling | Options page → `chrome.storage.local`. Never in source or baked into the bundle. |
| UI surface | Chrome Side Panel API (`chrome.sidePanel`), not a popup or injected overlay. |
| Extraction | `@mozilla/readability` in a content script, raw `innerText` fallback when Readability finds no article. |
| Build stack | Vite + TypeScript + React. |
| Fallback trigger | Page-grounded pass asks Nemotron for structured `{found_in_page, answer}` via `response_format: json_schema` (`strict: true`) **(verified working** against `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, returns clean JSON in `message.content`, chain-of-thought separately in `message.reasoning`, not `reasoning_content`**)**. `found_in_page: false` auto-triggers Tavily, no user click. |
| Context/truncation | No chunking. **(Verified** the model accepts 175K+ prompt tokens without error.) Defensive char-cap truncation only, as a guardrail. |
| Tavily scoping | `include_domains: [hostname]` **(verified** against the real Tavily `/search` endpoint — results correctly scoped to one domain). Not a `site:` query hack. |
| Streaming | Page-grounded pass: not streamed (structured JSON, usually fast). Tavily-fallback prose answer: streamed **(verified** standard OpenAI-compatible SSE shape over the real endpoint — see Risks). |
| Conversation shape | Multi-turn — prior Q&A pairs sent as history with each new question. |
| History storage | `chrome.storage.session`, keyed by tabId — survives MV3 service-worker restarts (Chrome kills idle service workers ~30s between events; a plain in-memory `Map` would silently lose history mid-conversation). |
| Testing | Unit tests on pure logic only (JSON-schema parsing, truncation, prompt assembly, domain-scoping). No e2e/Playwright. |
| Unreadable pages | Explicit "Can't read this page" state with input disabled — never silent Tavily-only fallthrough, never a raw unhandled error. |

## Pre-flight: Node version

Local Node is **v20.16.0 (verified)**. Vite 8 requires **`^20.19.0 || >=22.12.0` (verified via `npm view vite engines`)** — below that, `vite`/`vitest` will fail to start with a confusing module-loading error, not a clean version check. Upgrade to Node 22 LTS before Phase 1 (nvm/fnm/volta — trivial, not a risky jump).

## Packages to install

```bash
# runtime
npm install react@^19.3.0 react-dom@^19.3.0 @mozilla/readability@^0.6.0

# dev/build/test
npm install -D vite@^8.3.0 @vitejs/plugin-react@^6.1.1 @crxjs/vite-plugin@^2.7.1 \
  typescript@^5.9.3 vitest@^5.0.1 \
  @types/chrome@^0.3.0 @types/react@^19.3.0 @types/react-dom@^19.3.0 @types/node@^22
```

- **`@crxjs/vite-plugin` (verified** at `2.7.1`, published 2026-07-01, current — an earlier "unmaintained?" scare from its 2.0-beta era was resolved by steady releases since) handles the background/side-panel/options build. It had a real maintenance gap once; if it misbehaves on a future Vite patch, the fallback is a fully hand-rolled `rollupOptions.input` config — more wiring, zero plugin risk.
- TypeScript **5.9.3, not 7.x**: TS7's Go-rewritten compiler is real and fast, but it's new, its programmatic API isn't complete until 7.1, and this project has too few files for the speed win to matter. Boring and stable is the right call here.
- Vitest pairs natively with the Vite build — no separate config philosophy to maintain.

## Folder structure

```
sift/
├── manifest.config.ts        # crxjs defineManifest() — source of truth for manifest.json
├── vite.config.ts            # background + sidepanel + options (via crx())
├── vite.content.config.ts    # content script — separate build, see "Why two Vite configs" below
├── vitest.config.ts
├── tsconfig.json
├── public/icons/              # added in Phase 5
├── scripts/test-nebius.mjs    # existing, unchanged
└── src/
    ├── shared/
    │   ├── types.ts            # ExtractedPage, ChatTurn, PageGroundedResult, UnreadableReason
    │   ├── messages.ts         # message-passing contract (below)
    │   ├── constants.ts        # TRUNCATION_CHAR_LIMIT, MAX_HISTORY_TURNS, base URLs
    │   ├── storageKeys.ts
    │   ├── truncate.ts + .test.ts
    │   └── withRetry.ts        # one retry on network/5xx, never on 4xx (bad key surfaces immediately)
    ├── content/index.ts        # Readability (on a cloned document) + raw-text fallback
    ├── background/
    │   ├── index.ts            # top-level listener registration (see MV3 gotcha below) + router
    │   ├── keys.ts              # chrome.storage.local read helper
    │   ├── handlers/{extractPage,askQuestion,tavilyFallback}.ts
    │   ├── nebius/{client,modelDiscovery,promptAssembly,schema}.ts (+ .test.ts for the pure ones)
    │   ├── tavily/{client,scopeToDomain}.ts (+ .test.ts)
    │   └── history/sessionHistory.ts
    ├── sidepanel/
    │   ├── index.html, main.tsx, App.tsx, styles.css
    │   ├── components/{ChatThread,MessageBubble,ChatInput,LoadingIndicator,UnreadablePageState,MissingApiKeysState}.tsx
    │   └── hooks/{useActiveTab,useChat,useFallbackStream}.ts
    └── options/{index.html, main.tsx, App.tsx}   # two key inputs → chrome.storage.local
```

Tests are co-located (`*.test.ts` next to the module) — Vitest's default include pattern, no separate `tests/` tree.

## manifest.config.ts

```ts
import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Sift',
  version: pkg.version,
  description: "Ask questions about the page you're on.",
  // Broad host_permissions, not activeTab (revised during Phase 2 — see permission
  // gotcha #2 below): activeTab does not reliably re-grant when the toolbar icon is
  // clicked while the side panel is already open, which breaks extraction on ordinary
  // tab switches, not just cross-origin navigation.
  permissions: ['sidePanel', 'storage', 'scripting'],
  host_permissions: ['http://*/*', 'https://*/*'],
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  options_page: 'src/options/index.html',
  action: { default_title: 'Sift' },
})
```

No `content_scripts` entry — the content script is injected on demand via
`chrome.scripting.executeScript`, never statically declared. `action` is
present so `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`
(set once in `background/index.ts`) gives a single-click toolbar icon → open
side panel. No `icons` key until Phase 5 supplies real PNGs.

## Why two Vite configs

Chrome constraint (not a tooling limitation): a `content_scripts`/`executeScript`-injected file can never be an ES module — no manifest field supports it, and an injected `import` throws `Cannot use import statement outside a module`. `func`-based injection doesn't help either; Chrome serializes the function via `toString()`, which loses closures and imports, so it can't carry the Readability library. The only viable path is a **pre-bundled, dependency-free IIFE** loaded via `files`. Since that can't share crxjs's manifest-driven module graph, it needs its own Vite build:

```ts
// vite.content.config.ts
import { defineConfig } from 'vite'
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,   // must not wipe the main build's output
    lib: { entry: 'src/content/index.ts', formats: ['iife'], name: 'SiftContentScript', fileName: () => 'content-script.js' },
  },
})
```

Real consequence: two watchers during dev (`npm run dev` for crxjs/HMR,
`npm run dev:content` for the content script) — two terminal tabs, not worth
a `concurrently` dependency for a solo build.

`package.json` scripts to add (alongside the existing `test:nebius`):
`dev`, `dev:content` (`vite build --watch --config vite.content.config.ts`),
`build` (both builds), `typecheck` (`tsc --noEmit`), `test` (`vitest run`).

## Message-passing contract (`src/shared/messages.ts`, `src/shared/types.ts`)

```ts
export interface ExtractedPage {
  url: string;   // from document.URL in the content script — NOT chrome.tabs (see permission gotcha below)
  title: string;
  content: string;
  extractionMethod: 'readability' | 'raw-text';
  truncated: boolean;
}
export interface ChatTurn { role: 'user' | 'assistant'; content: string; source?: 'page' | 'web' }
export interface PageGroundedResult { found_in_page: boolean; answer: string }
export type UnreadableReason = 'restricted-url' | 'csp-blocked' | 'permission-denied' | 'no-content' | 'unknown-error';

export type BackgroundRequest =
  | { type: 'EXTRACT_PAGE'; tabId: number }
  | { type: 'ASK_QUESTION'; tabId: number; question: string }
  | { type: 'GET_HISTORY'; tabId: number }
  | { type: 'CLEAR_HISTORY'; tabId: number }
  | { type: 'GET_API_KEY_STATUS' };

export type BackgroundResponse =
  | { type: 'EXTRACT_PAGE_RESULT'; ok: true; page: ExtractedPage }
  | { type: 'EXTRACT_PAGE_RESULT'; ok: false; reason: UnreadableReason; message: string }
  | { type: 'ASK_QUESTION_RESULT'; ok: true; result: PageGroundedResult }
  | { type: 'ASK_QUESTION_RESULT'; ok: false; message: string }
  | { type: 'HISTORY_RESULT'; turns: ChatTurn[] }
  | { type: 'CLEARED' }
  | { type: 'API_KEY_STATUS'; nebiusConfigured: boolean; tavilyConfigured: boolean };

// content script -> background: correlated via sender.tab.id, NOT a self-reported field
// (a content script has no chrome.tabs access, so it structurally cannot supply its own tabId)
export type ContentScriptMessage =
  | { type: 'PAGE_EXTRACTED'; page: ExtractedPage }
  | { type: 'PAGE_EXTRACTION_FAILED'; reason: UnreadableReason; message: string };

// streaming port protocol — Tavily-fallback pass ONLY, page-grounded pass never uses this
export const FALLBACK_PORT_NAME = 'sift-fallback'
export type FallbackPortRequest = { type: 'START_FALLBACK'; tabId: number; question: string }
export type FallbackPortMessage =
  | { type: 'FALLBACK_CHUNK'; delta: string }
  | { type: 'FALLBACK_DONE'; fullText: string }
  | { type: 'FALLBACK_ERROR'; message: string }
```

One-shot request/response (`EXTRACT_PAGE`, `ASK_QUESTION`, etc.) goes over
plain `chrome.runtime.sendMessage`. Only the Tavily-fallback pass uses a
`chrome.runtime.connect` long-lived port — it's the one place with an
unbounded sequence of chunks to relay; forcing the single-shot page-grounded
call through a port would be unneeded ceremony.

## Two permission gotchas that shape the design

1. **`chrome.tabs.query()` never returns a populated `tab.url`** under an
   `activeTab`-only permission set — only bare `"tabs"` permission or matching
   `host_permissions` unlock it. This is now moot for `tab.url` specifically,
   since Phase 2's `host_permissions` fix (below) matches every http/https
   origin — but `ExtractedPage.url` still comes from the content script's own
   `document.URL`, not the Tabs API, since that's simpler than threading a
   second source of truth through the code for no benefit. `chrome.tabs.onActivated`/
   `onUpdated` still work fine for detecting *when* to re-extract, since
   `tabId`/`changeInfo.status` are unrestricted fields.
2. **`activeTab` does not reliably grant access the way the side panel needs
   it to (found empirically in Phase 2, not just assumed from docs).** The
   original assumption was narrower — that the grant is revoked on navigation
   to a new origin while the panel stays open, landing harmlessly in the
   `permission-denied` unreadable-page state. Real testing showed the problem
   is bigger: once the side panel is open, clicking the toolbar icon again
   does **not** reliably re-grant `activeTab` for the tab you're on — even an
   explicit, deliberate re-click on the target tab still failed with
   `executeScript`'s host-permission error. A persistent panel that reacts
   live to tab switches doesn't fit the transient-popup model `activeTab` was
   designed for. **Fix:** dropped `activeTab` entirely in favor of broad
   `host_permissions` (`http://*/*`, `https://*/*` — see `manifest.config.ts`
   above), so extraction no longer depends on click timing at all. The
   `permission-denied` reason and unreadable-page fallback stay in place for
   genuine cases (a tab closed mid-extraction, etc.), just not as the primary
   path for ordinary tab switching.

## Phase-by-phase tasks

### Phase 1 — Extension skeleton
Create `manifest.config.ts`, `vite.config.ts`, `vite.content.config.ts`, `tsconfig.json`, `vitest.config.ts`, `src/vite-env.d.ts`, placeholder `src/sidepanel/*` (heading only, no chat logic), `src/options/*` (two inputs + Save → `chrome.storage.local`), `src/background/index.ts` (just `setPanelBehavior` for now), `src/shared/storageKeys.ts`. Modify `package.json` (scripts + dependencies from above).
**Done when**: `npm run build` → `dist/` has a valid manifest → "Load unpacked" works with no console errors → toolbar icon opens the side panel placeholder → Options saves both keys (verify via the service worker's DevTools console, `chrome.storage.local.get`).

### Phase 2 — Extraction pipeline
Create `src/content/index.ts` (Readability on `document.cloneNode(true)` — `.parse()` is destructive to the document it's given — falling back to `document.body.innerText` when Readability returns null or `isProbablyReaderable()` is false), `src/shared/truncate.ts` + test (cap ~120,000 chars), `src/background/handlers/extractPage.ts` (`chrome.scripting.executeScript({files:['content-script.js']})`, correlate response via a listener scoped to `sender.tab.id`, ~5s timeout safety net, best-effort classification of rejection strings into `UnreadableReason`), `src/background/history/sessionHistory.ts` (caches `ExtractedPage` itself in `chrome.storage.session` too, so follow-ups don't re-extract every time), `src/sidepanel/components/UnreadablePageState.tsx`, `src/sidepanel/hooks/useActiveTab.ts`.
**Done when**: a normal article shows extracted content reaching the background (verify via service-worker console log); a `chrome://` page or the PDF viewer shows the disabled "Can't read this page" state, not a raw error; a very long page is flagged `truncated: true` without crashing.

**Two bugs found only by manually loading the unpacked extension and clicking through it, not by typecheck/tests/build:**
- The `activeTab` permission gotcha above (permission gotcha #2) — fixed by switching to broad `host_permissions`.
- **A message race in `extractPage.ts`:** `chrome.scripting.executeScript()`'s promise resolves once the injected script's *synchronous* top-level code finishes running — and the content script's `chrome.runtime.sendMessage(...)` call fires synchronously at the top level, without awaiting it. That means the response listener must be registered **before** calling `executeScript`, not after: registering it afterward (as first written) left a window where the content script's message could be dispatched — and silently dropped, since some listener already existed elsewhere (the top-level router) so Chrome resolved the sender's `sendMessage` promise cleanly anyway — before anything was listening for it, causing every extraction to hit the 5s timeout despite the content script visibly succeeding.

### Phase 3 — Core chat loop
Create `src/background/nebius/{client,modelDiscovery,promptAssembly,schema}.ts` (+ tests for `promptAssembly` and `schema`), `src/background/keys.ts`, `src/background/handlers/askQuestion.ts`, chat UI components, `src/sidepanel/hooks/useChat.ts`. Modify `src/background/index.ts` to register `ASK_QUESTION`/`GET_HISTORY`/`CLEAR_HISTORY`/`GET_API_KEY_STATUS` — **register all listeners at the top level**, not inside an async function, so a revived service worker re-attaches them before Chrome dispatches a queued event.

`modelDiscovery.ts` **reimplements** (doesn't import — different runtime, `chrome.storage.local` vs plain `process.env`) the discover-then-prefer pattern already established in [scripts/test-nebius.mjs](scripts/test-nebius.mjs): `GET /v1/models`, filter `/nemotron/i`, try a candidates list, fall back to first match. Cache the resolved model ID in a module-level variable for the service worker's lifetime (cheap; self-heals on restart). `schema.ts`'s `parsePageGroundedResult()` returns `{ok:true,result} | {ok:false,error}` rather than throwing — this is exactly what's worth unit-testing against malformed model output, not just the happy path.

**Done when**: an on-page question returns a "from the page" answer after a brief loading state; an off-page question returns `found_in_page:false` and currently just says so (no Tavily yet); a follow-up question ("what about the second one") correctly uses prior history; terminating the service worker mid-conversation (chrome://extensions → service worker → "terminate") does **not** lose history — confirms the `chrome.storage.session` choice actually works.

### Phase 4 — Tavily fallback
Create `src/background/tavily/{client,scopeToDomain}.ts` (+ test for `scopeToDomain`), `src/background/handlers/tavilyFallback.ts`, `src/sidepanel/hooks/useFallbackStream.ts` (wraps `chrome.runtime.connect({name: FALLBACK_PORT_NAME})`). Modify `background/index.ts` (`chrome.runtime.onConnect` for `sift-fallback`), `useChat.ts` (on `found_in_page:false`, open the port instead of showing pass-1's text), `MessageBubble.tsx` ("from the web" vs "from the page" label).

Tavily call uses `include_domains: [new URL(page.url).hostname]`, sourced from the **cached `ExtractedPage.url`** from Phase 2/3, not a fresh `chrome.tabs.query`. The second Nemotron call sets `stream: true` (no `response_format`) and parses standard SSE.

**SSE parsing detail (verified this session, not in the original design):** buffer the trailing incomplete line across `reader.read()` calls before splitting on `\n` — a single JSON `data:` payload can be split across two reads, and parsing each read's text as if it always contains whole lines drops chunks intermittently. Also **(verified)**: `delta.reasoning` chunks stream before `delta.content` chunks for this model — only start rendering visible answer text once `delta.content` appears, don't surface raw chain-of-thought as if it were the answer.

**Done when**: an off-page question shows a visible "searching the web" transition, prose streams in token-by-token, and a spot-check (asking something answered only on a *different* domain) confirms it does not leak into results.

**Search-quality bug found only by testing against a real page, not by typecheck/tests/build:** the first implementation sent Tavily the bare user question at the default `search_depth: 'basic'`. Verified live against `transformer-circuits.pub`: for "what GPU is used to train this" on the article page, none of the 10 basic-depth results were the article itself (top score 0.25, mostly unrelated posts that happened to mention "GPU"). **Fix:** `search_depth: 'advanced'` plus folding `page.title` into the query (`` `${question} (${page.title})` ``) — re-verified live, top result became the article itself at score 0.57. `searchTavily()` now takes `pageTitle` alongside `pageUrl` for this reason.

### Phase 5 — Tests + polish
Create the four unit-test files placed alongside their modules above, `src/shared/withRetry.ts` (one retry on network/5xx failure; 4xx — e.g. a bad API key — surfaces immediately as "check your API key in Options," never retried), `public/icons/{16,48,128}.png`. Modify `manifest.config.ts` (add `icons`), both API `client.ts` files (wrap calls in `withRetry`), [README.md](README.md) (real setup/build/load-unpacked instructions, replacing the "early development" placeholder).
**Done when**: `npm run test` passes; `npm run typecheck` is clean; a full manual pass — Load unpacked → Options → save keys → open an article → on-page question → off-page question with visible Tavily streaming → open a `chrome://` tab and confirm the disabled state — works with no console errors; README matches the real commands.

## Verification (end to end)

1. `node --version` → confirm ≥20.19 before starting Phase 1.
2. After each phase, use the phase's own "Done when" criteria above — each phase is independently demoable before the next starts.
3. `npm run typecheck && npm run test` before considering Phase 5 complete.
4. Final manual rehearsal: the exact click-through sequence in Phase 5's "Done when," run once start-to-finish with the side-panel DevTools console open, watching for any error/warning.

## Known risks (ranked by concreteness)

1. Node 20.16.0 → 22 LTS upgrade is a hard prerequisite, not optional (verified against Vite's actual `engines` field).
2. ~~`chrome.tabs.query().url` will silently be `undefined` under this permission set~~ — superseded: Phase 2 dropped `activeTab` for broad `host_permissions`, so `tab.url` would actually resolve now. `ExtractedPage.url` still comes from the content script's `document.URL` regardless, by design (see permission gotcha #1), not because the Tabs API is blocked.
3. **(materialized in Phase 2, real fix applied)** `activeTab` turned out not to reliably grant access at all once the side panel is already open — not just revoked on cross-origin navigation as originally assumed, but never re-granted even on a deliberate re-click of the toolbar icon on the target tab. Fixed by switching to broad `host_permissions` (`http://*/*`, `https://*/*`) instead of depending on `activeTab` timing.
4. `executeScript` rejection reasons are free-text strings — classification into `UnreadableReason` is necessarily best-effort substring matching. (Confirmed in Phase 2: Chrome uses the *same* message — "Cannot access contents of the page. Extension manifest must request permission to access the respective host." — for both a restricted `chrome://` page and an ungranted regular page, so this classifier alone can't always tell them apart; the `host_permissions` fix above removes the ungranted-regular-page case entirely rather than trying to disambiguate the string.)
5. The content script's build living outside crxjs's manifest-driven graph (Chrome's own constraint, not a tooling gap) means two Vite configs and two dev watchers — accepted friction, not a bug to fix.
6. SSE responses can split a single JSON payload across two stream reads (verified by reproducing it live) — the fallback parser must buffer trailing partial lines, not assume one `read()` = whole lines.
7. **(found in Phase 2)** `chrome.scripting.executeScript()`'s promise resolves once the injected script's *synchronous* top-level code finishes — which can be before an `onMessage` listener registered *after* that call has a chance to attach, silently dropping the content script's response. The response listener must be registered before calling `executeScript`, not after.
