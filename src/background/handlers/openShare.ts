import type { BackgroundRequest, BackgroundResponse } from '../../shared/messages'
import { SHARE_LANDING_URL } from '../../shared/shareLanding'
import { isSharedPair } from '../../shared/shareSnapshot'
import { setShareSnapshot } from '../history/sessionHistory'

type ShareOpen = Extract<BackgroundRequest, { type: 'SHARE_OPEN' }>

// Opens the panel before any await so the click's gesture still counts (ADR 0008), then stores the thread.
export async function openShare(
  message: ShareOpen,
  sender: Pick<chrome.runtime.MessageSender, 'tab' | 'url'>,
  openPanel: (tabId: number) => void,
): Promise<BackgroundResponse | { type: 'SHARE_REJECTED' }> {
  const tabId = sender.tab?.id
  const valid =
    tabId !== undefined &&
    sender.url?.startsWith(SHARE_LANDING_URL) &&
    /^https?:\/\//.test(message.pageUrl) &&
    Array.isArray(message.pairs) &&
    message.pairs.every(isSharedPair)
  if (!valid) return { type: 'SHARE_REJECTED' }

  openPanel(tabId)
  await setShareSnapshot(tabId, { pageUrl: message.pageUrl, pairs: message.pairs })
  return { type: 'SHARE_OPENED' }
}
