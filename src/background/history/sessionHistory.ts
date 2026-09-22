import { MAX_HISTORY_TURNS } from '../../shared/constants'
import type { ChatTurn, ExtractedPage } from '../../shared/types'

function pageStorageKey(tabId: number): string {
  return `sift:page:${tabId}`
}

function historyStorageKey(tabId: number): string {
  return `sift:history:${tabId}`
}

export async function setExtractedPage(tabId: number, page: ExtractedPage): Promise<void> {
  await chrome.storage.session.set({ [pageStorageKey(tabId)]: page })
}

export async function getExtractedPage(tabId: number): Promise<ExtractedPage | undefined> {
  const key = pageStorageKey(tabId)
  const stored = await chrome.storage.session.get(key)
  return stored[key] as ExtractedPage | undefined
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

export async function clearHistory(tabId: number): Promise<void> {
  await chrome.storage.session.remove(historyStorageKey(tabId))
}
