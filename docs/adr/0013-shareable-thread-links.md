# 13. Threads are shared as links that carry the thread in the fragment

- Status: proposed
- Date: 2026-10-13
- Related: [#87](https://github.com/aishahsofea/sift/issues/87), [#85](https://github.com/aishahsofea/sift/issues/85), [ADR 0008](0008-side-panel-is-opened-per-tab-by-hand.md)

## Context

A thread is only useful to the person who had it. #87 asks for a link that opens
the original page with the Sift panel showing that thread, read-only. #85 spiked
the idea and said go. There is no backend to store threads in, and no Web Store
listing to point people at.

## Decision

- **The thread lives in the link.** The link is
  `https://aishahsofea.github.io/sift/#u=<page url>&d=<payload>`. A URL fragment
  is never sent to the host, so nothing is stored or logged on a server.
- **Payload.** Per question: `{question, answer, source, quotes}`, wrapped as
  `{v: 1, pairs}`, compressed with deflate-raw and base64url
  (`src/shared/shareSnapshot.ts`). Left out: selections, steps, stats, web pages,
  the truncation flags and the repeated page URL.
- **Size cap.** The fragment may not pass `SHARE_FRAGMENT_CHAR_LIMIT` (8,000).
  - Over it, `buildShareLink` keeps the last N questions that fit and reports how
    many it dropped. The share dialog says so and asks before copying.
  - If not even the last question fits, there is no link.
- **Hosted page.** `site/` is a static page, built by `npm run build:site` and
  deployed to GitHub Pages by `.github/workflows/pages.yml`. It decodes the
  fragment with the extension's own codec and shows the thread as plain text, an
  install prompt that points at the latest GitHub release, or an error for a bad
  link. It sets `no-referrer` and sends nothing anywhere.
- **Handoff.**
  1. A content script declared in the manifest, matched to the landing origin
     only, marks the page as having Sift.
  2. Clicking "Open with Sift" sends the decoded thread to the worker.
  3. The worker checks that the sender is the landing page and that the data has
     the right shape.
  4. It calls `openPanel` before any `await` (the gesture rule from ADR 0008).
  5. It stores the snapshot in `chrome.storage.session` under the tab's id, and
     replies.
  6. The page goes to the original URL.
- **Panel.** If the tab has a snapshot, `App` renders it read-only instead of
  `ChatApp`: no extraction, no history writes, no composer, no edit or regenerate.
  "Start my own thread" removes the snapshot and the tab goes back to normal.

## Consequences

- Sift now declares a content script and a hosted origin. The landing URL is a
  constant, so no setting can widen the manifest match. crxjs also lists the
  script's chunks as web-accessible to that origin.
- Anyone with the link can read the thread, and it can end up in chat history
  and link previews; the dialog says so before copying. The page address is
  included in full, query string and all.
- A thread over the cap is shared as its tail, so a recipient may miss the
  start of the conversation. The dialog says how many questions were left out.
- Recipients without Sift get a plain-text copy of the thread and an install
  prompt that points at the GitHub release, because PLAN.md says there is no Web
  Store listing. Change that link if one appears.
- A `#sift=` entry on the original site, read through `tabs.onUpdated`, was left
  out. It is a separate follow-up.

## Verification

Checked here: unit tests for the codec, the cap, bad input, the worker handler
(panel opened before the first await, bad senders and shapes rejected), the
dialog states and the read-only panel. The landing page was opened in a browser
with a good link and a damaged one; a question holding `<b>` showed as text.

Not yet checked, and needed before this is `accepted`:

- The click-through in Chrome: that `sidePanel.open` accepts a gesture carried by
  a content-script message, and that the panel stays open across the navigation.
- How chat apps treat an 8,000-character link. Record what each one does here,
  and change the constant if one cuts it off.
