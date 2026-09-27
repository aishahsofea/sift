# 8. Side panel is opened per tab by hand, not via a manifest `default_path`

- Status: accepted
- Date: 2026-09-27
- Related: [issue #14](https://github.com/aishahsofea/sift/issues/14); supersedes
  PLAN.md's "permission gotcha #2" and its `manifest.config.ts` `side_panel` snippet

## Context

Clicking the toolbar icon in one tab opened the side panel in every tab of that
window: switching tabs kept the same panel document open and just re-triggered
extraction for whichever tab had become active, since `useActiveTab` tracked
`chrome.tabs.onActivated`. Chat state (`useAskStream`) wasn't keyed by tab either, so
an answer streaming in tab A could render into tab B if the user switched mid-stream.

The manifest declared `side_panel: { default_path: 'src/sidepanel/index.html' }` and
`background/index.ts` called `chrome.sidePanel.setPanelBehavior({
openPanelOnActionClick: true })`. Both are the *global* side panel configuration —
one instance shared by the whole window — which is exactly what the bug describes.

The obvious fix, `chrome.sidePanel.setOptions({ tabId, path, enabled: true })` per
tab, turns out not to work while `default_path` is still declared: with both present,
Chrome keeps treating the panel as global regardless of the per-tab call. This isn't
speculation — it's a filed, reproduced, and confirmed Chrome bug/quirk in Google's own
samples repo ([GoogleChrome/chrome-extensions-samples#987](https://github.com/GoogleChrome/chrome-extensions-samples/issues/987)),
where removing the manifest's `default_path` entirely was the fix multiple reporters
confirmed. The same thread also settled two smaller gotchas:

- `sidePanel.open()` only counts as "called in response to a user gesture" when it
  runs synchronously inside the click handler — `await`-ing `setOptions()` first (a
  reasonable-looking fix for a separate "no active side panel for tabId" error) breaks
  that, so `setOptions` must be fired without awaiting it, immediately followed by a
  synchronous `open()` call.
- A side panel document has no working API to ask Chrome which tab it's attached to.
  `chrome.tabs.getCurrent()` — the obvious candidate — does not resolve inside a side
  panel ([confirmed on the chromium-extensions mailing list](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/_yGH5nzOQAc)).
  The community-endorsed workaround is encoding the tab id as a query parameter on the
  panel's own path and reading it back with `location.search`.

## Decision

1. Drop `side_panel.default_path` from `manifest.config.ts`. No manifest field
   declares the panel at all now — Chrome doesn't need one to open a page as a side
   panel via the JS API, only the `sidePanel` permission (unchanged).
2. `background/index.ts` no longer calls `setPanelBehavior`. Instead:
   ```ts
   chrome.action.onClicked.addListener((tab) => {
     if (tab.id === undefined) return
     const tabId = tab.id
     chrome.sidePanel
       .setOptions({ tabId, path: `src/sidepanel/index.html?tabId=${tabId}`, enabled: true })
       .catch(...)
     chrome.sidePanel.open({ tabId }).catch(...)
   })
   ```
   `setOptions` is not awaited, and `open` is called synchronously right after it, per
   the gotcha above.
3. `useActiveTab.ts` reads its own tab id out of `location.search` instead of querying
   `chrome.tabs.query({active, currentWindow})` or listening to `onActivated`. It keeps
   listening to `onUpdated`, filtered to its own tab id, so a same-tab navigation still
   re-triggers extraction.

Since `crxjs`'s Vite plugin discovers HTML entry points (options page, side panel,
etc.) from those same manifest fields, removing `default_path` also removes
`src/sidepanel/index.html` from the build. `vite.config.ts` now declares it as an
ordinary extra Rollup input instead:
```ts
build: { rollupOptions: { input: { sidepanel: 'src/sidepanel/index.html' } } }
```

## Verification

Confirmed by diffing `npm run build` output: with `default_path` removed and no
replacement entry, `dist/src/sidepanel/index.html` and its JS/CSS bundle disappeared
entirely (210 → 37 modules transformed) even though `manifest.json`, the options page,
and the content script all still built correctly. Adding the `rollupOptions.input`
entry above restored the exact same output (`dist/src/sidepanel/index.html`, correctly
wired to its built JS/CSS, `dist/manifest.json` with no `side_panel` key and
`sidePanel` still in `permissions`). `npm run typecheck` and `npm run test` (259
tests) both pass unchanged.

The multi-tab runtime behavior itself — the actual point of #14 — is **not**
verified here. `chrome.sidePanel`/`chrome.action` aren't exercised by the Vitest
suite (nothing under `chrome.*` is, per AGENTS.md), and this environment has no real
Chrome to load the unpacked build into. This still needs the same manual check the
issue asks for: load `dist/` unpacked, open two tabs, confirm tab A's panel and
conversation don't appear in tab B.

## Consequences

- PLAN.md's permission gotcha #2 described broad `host_permissions` as necessary
  because "a persistent panel that reacts live to tab switches doesn't fit the
  transient-popup model `activeTab` was designed for." That framing no longer holds —
  the panel is no longer persistent or window-wide. The empirical finding underneath
  it (re-clicking the toolbar icon while the panel was already open did not reliably
  re-grant `activeTab`) was a separately-verified Chrome behavior, not re-tested under
  this new per-tab-click model, so `host_permissions` stays broad rather than risking
  a regression to that bug on a guess.
- `useActiveTab` no longer listens to `chrome.tabs.onActivated` at all — a panel bound
  to one tab for its whole life has no reason to react to a different tab becoming
  active.
- If a future feature needs the side panel to show different content depending on the
  page (not just per tab), the query-string convention here (`?tabId=`) is the place
  to add more parameters, following the same pattern Chrome's own site-specific sample
  uses for per-tab `setOptions`.
