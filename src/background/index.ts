import type { BackgroundRequest, BackgroundResponse } from '../shared/messages'
import { extractPage } from './handlers/extractPage'

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set side panel behavior', error))

// Registered at the top level (not inside an async function) so a revived
// service worker re-attaches this listener before Chrome dispatches a queued event.
chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_PAGE') {
    extractPage(message.tabId)
      .then(sendResponse)
      .catch((error) => {
        const response: BackgroundResponse = {
          type: 'EXTRACT_PAGE_RESULT',
          ok: false,
          reason: 'unknown-error',
          message: error instanceof Error ? error.message : 'Unknown error extracting page.',
        }
        sendResponse(response)
      })
    return true
  }

  return undefined
})
