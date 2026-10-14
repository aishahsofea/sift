# Chrome Web Store listing

Text to paste into the developer dashboard for #86. The data-use answers match
[the privacy policy](../../site/privacy.html).

## Listing

**Name:** Sift

**Category:** Productivity

**Language:** English

**Short description** (limit 132 characters):

> Ask questions about the page you're reading. Answers quote the page, or search the rest of the site when it falls short.

**Detailed description:**

```
Sift reads the page you're on and answers your questions about it, in a side panel next to the page.

HOW IT WORKS
- Open any web page and click the Sift icon. Ask a question.
- If the page covers it, the answer comes from the page, with quotes you can click to see highlighted in place. Each quote is checked against the page text, so a made-up quote is rejected.
- If the page doesn't cover it, Sift searches the rest of the same site and answers from what it finds. These answers are labeled "from the web".
- Select text on a page, right-click, and choose "Ask Sift about this selection".
- Long pages are searched locally, so questions about the end of a long article still work.
- Share a thread as a link. The thread travels in the link itself; no account and no server copy.

POWERED BY
NVIDIA Nemotron models served by Nebius Token Factory, with Tavily for site-scoped search.

PRIVACY
- Sift reads a page only when you ask a question about it, never in the background.
- The page text, your questions and the page URL are sent to Nebius Token Factory to produce the answer. Search queries go to Tavily.
- No account, no analytics, no ads. Conversations are kept only until you close the browser.
- Works out of the box through a free demo server with daily limits. Add your own Nebius and Tavily keys on the options page to call them directly; keys stay on your device.

Open source: https://github.com/aishahsofea/sift
```

**Privacy policy URL:** the deployed `privacy.html` on the Pages site (confirm
the exact URL after the Pages deploy).

**Homepage URL:** https://github.com/aishahsofea/sift

**Visibility for the first release:** Unlisted. Switch to Public later in the
dashboard without a new review.

## Single purpose

> Answer questions about the web page the user is viewing, using the page's text and, when needed, a search of the same site.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `sidePanel` | The whole interface is a side panel that sits next to the page being read. |
| `storage` | Keeps the user's optional API keys on their device (`storage.local`), and the current conversation, extracted page text and selection hand-off until the browser closes (`storage.session`). |
| `scripting` | Injects the content script into the current tab, when the user asks a question or picks "Ask Sift about this selection", to read the page's text and any selected text. It also injects a highlight into the page when the user clicks a quote to see it in place. |
| `contextMenus` | Adds one item, "Ask Sift about this selection", shown only when text is selected. |
| Host permissions `http://*/*`, `https://*/*` | Sift answers questions about whatever page the user happens to be on, so the page can't be known ahead of time. The access is used only to read the current tab's text and show quote highlights there, and only after a user action (asking a question, using the context menu, or clicking a quote). Pages are never read in the background. It does not cause requests to the visited site; network calls go only to Nebius, Tavily and the demo server. |
| Content script on the share-link page | Runs only on Sift's own share-link page. It marks the page so it can show "Open with Sift" instead of an install prompt, and on that click passes the thread in the link's `#` fragment to the extension. It touches no other site. |

Why not `activeTab`: re-clicking the toolbar icon while the panel was already
open didn't reliably re-grant it for the clicked tab (see the comment in
`manifest.config.ts`). If review pushes back on the broad host access, the
fallback is `activeTab` plus `optional_host_permissions`, which needs the
side-panel flow re-tested first.

## Remote code

**Does the extension use remote code?** No. All code is in the package. The
extension calls remote APIs for data (model responses, search results), but
downloads no scripts.

## Data-use disclosures

Check these under "What user data do you plan to collect?":

- **Website content** (page text, selected text, and the page URL, sent to
  Nebius and the demo server to answer the question)
- **Web history** (the URL of the page being asked about, sent with the question)
- **Authentication information** (the user's own optional Nebius and Tavily API
  keys, stored locally and sent only to the service each belongs to)

Leave unchecked: personally identifiable information, health, financial,
personal communications, location, user activity (clicks, keystrokes).

Then certify all three:

- I do not sell or transfer user data to third parties, outside of the approved
  use cases. (Nebius and Tavily are the processors that answer the request.)
- I do not use or transfer user data for purposes unrelated to the item's
  single purpose.
- I do not use or transfer user data to determine creditworthiness or for
  lending purposes.

## Assets

| Asset | Requirement | Status |
| --- | --- | --- |
| Icon | 128×128 PNG | `public/icons/128.png` exists; check it isn't a placeholder |
| Screenshots | 1 to 5, 1280×800 or 640×400 | To capture |
| Small promo tile | 440×280 (optional) | Optional |

Suggested screenshots, each 1280×800:

1. A page answer with "from the page · N quotes checked" showing.
2. A quote clicked and highlighted on the page.
3. A "from the web" answer after a site search.
4. The "Ask Sift about this selection" context menu.
5. The options page, showing where keys go.
