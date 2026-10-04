import { MAX_HISTORY_TURNS } from '../../shared/constants'
import type { ChatTurn, ExtractedPage } from '../../shared/types'

function pageStorageKey(tabId: number): string {
  return `sift:page:${tabId}`
}

// Own key, so reading the page per question doesn't also read the megabyte the model rarely needs (#11).
function fullTextStorageKey(tabId: number): string {
  return `sift:fulltext:${tabId}`
}

function historyStorageKey(tabId: number): string {
  return `sift:history:${tabId}`
}

// Stores the page and, if cut, its whole text; `searchable` says whether the text is there. Storage can fail (10 MB session quota), then the page goes in alone, as before #11; a new page clears the old text.
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

// Counted from the end since stored history is capped at MAX_HISTORY_TURNS; used by edit-and-resend (#46) and regenerate (#43).
export async function dropLastHistoryTurns(tabId: number, count: number): Promise<ChatTurn[]> {
  const existing = await getHistory(tabId)
  const kept = existing.slice(0, Math.max(0, existing.length - count))
  await chrome.storage.session.set({ [historyStorageKey(tabId)]: kept })
  return kept
}

export async function clearHistory(tabId: number): Promise<void> {
  await chrome.storage.session.remove(historyStorageKey(tabId))
}

// Tab ids aren't reused, so nothing else would remove a closed tab's data, which now includes a whole page.
export async function clearTabData(tabId: number): Promise<void> {
  await chrome.storage.session.remove([pageStorageKey(tabId), fullTextStorageKey(tabId), historyStorageKey(tabId)])
}
