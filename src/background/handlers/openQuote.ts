import { highlightQuote } from '../../content/highlightQuote'
import { textFragmentUrl } from '../../shared/textFragment'

const HIGHLIGHT_CSS = '::highlight(sift-quote) { background-color: #ffe066; color: #000; }'

const withoutHash = (url: string) => url.split('#')[0]

async function highlightInTab(tabId: number, quote: string): Promise<boolean> {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, css: HIGHLIGHT_CSS })
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: highlightQuote, args: [quote] })
    return injection?.result === true
  } catch {
    return false
  }
}

// Highlights the quote in the live page; otherwise, if the turn knows its page, opens that page at the quote.
export async function openQuote(tabId: number, quote: string, url?: string): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId)
    const onSamePage = !url || (tab.url !== undefined && withoutHash(tab.url) === withoutHash(url))
    if (onSamePage && (await highlightInTab(tabId, quote))) return
    if (url) await chrome.tabs.create({ url: textFragmentUrl(url, quote), active: true })
  } catch {
    // the tab closed, or the page can't be opened: nothing to show
  }
}
