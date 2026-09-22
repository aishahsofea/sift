import { useEffect, useState } from 'react'
import type { BackgroundRequest, BackgroundResponse } from '../../shared/messages'
import type { ExtractedPage, UnreadableReason } from '../../shared/types'

export type ActiveTabStatus =
  | { state: 'loading' }
  | { state: 'ready'; page: ExtractedPage }
  | { state: 'unreadable'; reason: UnreadableReason; message: string }

export function useActiveTab(): { tabId: number | null; status: ActiveTabStatus } {
  const [tabId, setTabId] = useState<number | null>(null)
  const [status, setStatus] = useState<ActiveTabStatus>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function extract(id: number) {
      setStatus({ state: 'loading' })
      const request: BackgroundRequest = { type: 'EXTRACT_PAGE', tabId: id }
      const response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse
      if (cancelled || response.type !== 'EXTRACT_PAGE_RESULT') return
      setStatus(
        response.ok
          ? { state: 'ready', page: response.page }
          : { state: 'unreadable', reason: response.reason, message: response.message },
      )
    }

    async function init() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (cancelled || tab?.id === undefined) return
      setTabId(tab.id)
      extract(tab.id)
    }

    function handleActivated(info: chrome.tabs.OnActivatedInfo) {
      setTabId(info.tabId)
      extract(info.tabId)
    }

    function handleUpdated(updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) {
      if (changeInfo.status === 'complete' && tab.active) {
        setTabId(updatedTabId)
        extract(updatedTabId)
      }
    }

    init()
    chrome.tabs.onActivated.addListener(handleActivated)
    chrome.tabs.onUpdated.addListener(handleUpdated)

    return () => {
      cancelled = true
      chrome.tabs.onActivated.removeListener(handleActivated)
      chrome.tabs.onUpdated.removeListener(handleUpdated)
    }
  }, [])

  return { tabId, status }
}
