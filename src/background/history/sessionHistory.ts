import { MAX_HISTORY_TURNS } from '../../shared/constants'
import type { ChatTurn, ExtractedPage } from '../../shared/types'

function pageStorageKey(tabId: number): string {
  return `sift:page:${tabId}`
}

// The whole text of a page longer than the prompt holds (#11). Its own key, so reading
// the page for each question doesn't also read the megabyte the model rarely needs.
function fullTextStorageKey(tabId: number): string {
  return `sift:fulltext:${tabId}`
}

function historyStorageKey(tabId: number): string {
  return `sift:history:${tabId}`
}

// Stores the page a prompt is built from and, for a page cut short, the whole of its
// text beside it. Returns the page as stored: `searchable` says whether the whole text
// is there, which is what decides whether the model is offered search_page.
//
// Storing the whole text can fail (chrome.storage.session holds 10 MB across every tab),
// and that must not take extraction with it: the page then goes in alone, unsearchable,
// which is how every long page was handled before #11. A new page also removes the
// previous page's text for the tab, which would otherwise be searched as this one's.
export async function setExtractedPage(tabId: number, page: ExtractedPage, fullContent?: string): Promise<ExtractedPage> {
  if (page.truncated && fullContent !== undefined) {
    const searchable = { ...page, searchable: true }
    try {
      await chrome.storage.session.set({ [pageStorageKey(tabId)]: searchable, [fullTextStorageKey(tabId)]: fullContent })
      return searchable
    } catch (error) {
      console.warn(`[Sift] couldn't keep the whole page for tab ${tabId} (${fullContent.length} chars); its head only:`, error)
    }
  }
  const head = { ...page, searchable: false }
  await chrome.storage.session.remove(fullTextStorageKey(tabId))
  await chrome.storage.session.set({ [pageStorageKey(tabId)]: head })
  return head
}

export async function getExtractedPage(tabId: number): Promise<ExtractedPage | undefined> {
  const key = pageStorageKey(tabId)
  const stored = await chrome.storage.session.get(key)
  return stored[key] as ExtractedPage | undefined
}

// The whole text of the page, or undefined when it wasn't kept.
export async function getFullPageContent(tabId: number): Promise<string | undefined> {
  const key = fullTextStorageKey(tabId)
  const stored = await chrome.storage.session.get(key)
  return stored[key] as string | undefined
}

export async function getHistory(tabId: number): Promise<ChatTurn[]> {
  const key = historyStorageKey(tabId)
  const stored = await chrome.storage.session.get(key)
  return (stored[key] as ChatTurn[] | undefined) ?? []
}

export async function appendHistoryTurns(tabId: number, turns: ChatTurn[]): Promise<ChatTurn[]> {
  const existing = await getHistory(tabId)
  const updated = [...existing, ...turns].slice(-MAX_HISTORY_TURNS)
  await chrome.storage.session.set({ [historyStorageKey(tabId)]: updated })
  return updated
}

// Drops the last `count` turns. Counted from the end, not by index: stored history is capped
// at MAX_HISTORY_TURNS, so the panel's turn indexes can run ahead of it, but both end alike.
// Shared by edit-and-resend (#46) and regenerate (#43).
export async function dropLastHistoryTurns(tabId: number, count: number): Promise<ChatTurn[]> {
  const existing = await getHistory(tabId)
  const kept = existing.slice(0, Math.max(0, existing.length - count))
  await chrome.storage.session.set({ [historyStorageKey(tabId)]: kept })
  return kept
}

export async function clearHistory(tabId: number): Promise<void> {
  await chrome.storage.session.remove(historyStorageKey(tabId))
}

// Everything kept for a tab that has closed. Tab ids aren't reused, so nothing would
// ever remove these, and a whole page is far more than the head that used to be kept.
export async function clearTabData(tabId: number): Promise<void> {
  await chrome.storage.session.remove([pageStorageKey(tabId), fullTextStorageKey(tabId), historyStorageKey(tabId)])
}
