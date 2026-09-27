import { ASK_PORT_NAME, type AskPortRequest, type BackgroundRequest, type BackgroundResponse } from '../shared/messages'
import { runAgentLoop } from './handlers/agentLoop'
import { extractPage } from './handlers/extractPage'
import { clearHistory, clearTabData, getHistory } from './history/sessionHistory'
import { getApiKeys } from './keys'

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set side panel behavior', error))

// A closed tab's page, whole text and history go with it. Registered at the top level,
// like the listeners below. Needs no `tabs` permission: it reads only the id.
chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabData(tabId).catch((error) => console.error(`[Sift] couldn't clear tab ${tabId}:`, error))
})

// Registered at the top level, same reasoning as the onMessage listener below.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ASK_PORT_NAME) return
  port.onMessage.addListener((message: AskPortRequest) => {
    if (message.type !== 'START_ASK') return
    runAgentLoop(port, message.tabId, message.question)
  })
})

// Registered at the top level (not inside an async function) so a revived
// service worker re-attaches this listener before Chrome dispatches a queued event.
chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  switch (message.type) {
    case 'EXTRACT_PAGE':
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

    case 'GET_HISTORY':
      getHistory(message.tabId).then((turns) => {
        const response: BackgroundResponse = { type: 'HISTORY_RESULT', turns }
        sendResponse(response)
      })
      return true

    case 'CLEAR_HISTORY':
      clearHistory(message.tabId).then(() => {
        const response: BackgroundResponse = { type: 'CLEARED' }
        sendResponse(response)
      })
      return true

    case 'GET_API_KEY_STATUS':
      getApiKeys().then(({ nebiusApiKey, tavilyApiKey }) => {
        const response: BackgroundResponse = {
          type: 'API_KEY_STATUS',
          nebiusConfigured: Boolean(nebiusApiKey),
          tavilyConfigured: Boolean(tavilyApiKey),
        }
        sendResponse(response)
      })
      return true

    default:
      return undefined
  }
})
