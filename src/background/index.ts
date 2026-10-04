import { ASK_PORT_NAME, type AskPortRequest, type BackgroundRequest, type BackgroundResponse } from '../shared/messages'
import { runAgentLoop } from './handlers/agentLoop'
import { extractPage } from './handlers/extractPage'
import { clearHistory, clearTabData, getHistory } from './history/sessionHistory'
import { getApiKeys } from './keys'

const SIDE_PANEL_PATH = 'src/sidepanel/index.html'

// Tab-scoped (#14): the panel opens here with `?tabId=`; setOptions isn't awaited so open() stays sync.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return
  const tabId = tab.id
  chrome.sidePanel
    .setOptions({ tabId, path: `${SIDE_PANEL_PATH}?tabId=${tabId}`, enabled: true })
    .catch((error) => console.error(`[Sift] Failed to configure side panel for tab ${tabId}:`, error))
  chrome.sidePanel
    .open({ tabId })
    .catch((error) => console.error(`[Sift] Failed to open side panel for tab ${tabId}:`, error))
})

// A closed tab's page, whole text and history go with it; reads only the id, so no `tabs` permission.
chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabData(tabId).catch((error) => console.error(`[Sift] couldn't clear tab ${tabId}:`, error))
})

// Registered at the top level, same reasoning as the onMessage listener below.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ASK_PORT_NAME) return
  port.onMessage.addListener((message: AskPortRequest) => {
    if (message.type !== 'START_ASK') return
    runAgentLoop(port, message.tabId, message.question, message.rewind)
  })
})

// Top level, so a revived service worker re-attaches before Chrome dispatches a queued event.
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
