import { useEffect, useState } from 'react'
import type { BackgroundRequest, BackgroundResponse } from '../../shared/messages'
import type { ExtractedPage, UnreadableReason } from '../../shared/types'

export type ActiveTabStatus =
  | { state: 'loading' }
  | { state: 'ready'; page: ExtractedPage }
  | { state: 'unreadable'; reason: UnreadableReason; message: string }

// The panel is tab-scoped (#14): background/index.ts opens it with this tab's own id
// on the path (`?tabId=`), since a side panel document has no API of its own to ask
// which tab it's attached to — chrome.tabs.getCurrent() does not resolve here.
function ownTabId(): number | null {
  const raw = new URLSearchParams(window.location.search).get('tabId')
  const parsed = raw === null ? NaN : Number(raw)
  return Number.isInteger(parsed) ? parsed : null
}

export function useActiveTab(): { tabId: number | null; status: ActiveTabStatus } {
  const [tabId] = useState(ownTabId)
  const [status, setStatus] = useState<ActiveTabStatus>({ state: 'loading' })

  useEffect(() => {
    if (tabId === null) return
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

    // This panel belongs to one tab for its whole life, so a navigation on any other
    // tab is none of its concern — unlike the old window-wide panel, there's no other
    // tab to switch to.
    function handleUpdated(updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        extract(updatedTabId)
      }
    }

    extract(tabId)
    chrome.tabs.onUpdated.addListener(handleUpdated)

    return () => {
      cancelled = true
      chrome.tabs.onUpdated.removeListener(handleUpdated)
    }
  }, [tabId])

  return { tabId, status }
}
