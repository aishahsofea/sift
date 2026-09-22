import type { ExtractedPage } from '../../shared/types'

function pageStorageKey(tabId: number): string {
  return `sift:page:${tabId}`
}

export async function setExtractedPage(tabId: number, page: ExtractedPage): Promise<void> {
  await chrome.storage.session.set({ [pageStorageKey(tabId)]: page })
}

export async function getExtractedPage(tabId: number): Promise<ExtractedPage | undefined> {
  const key = pageStorageKey(tabId)
  const stored = await chrome.storage.session.get(key)
  return stored[key] as ExtractedPage | undefined
}
