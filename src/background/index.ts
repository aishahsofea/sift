import { FALLBACK_PORT_NAME, type BackgroundRequest, type BackgroundResponse, type FallbackPortRequest } from '../shared/messages'
import { askQuestion } from './handlers/askQuestion'
import { extractPage } from './handlers/extractPage'
import { runTavilyFallback } from './handlers/tavilyFallback'
import { clearHistory, getHistory } from './history/sessionHistory'
import { getApiKeys } from './keys'

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set side panel behavior', error))

// Registered at the top level, same reasoning as the onMessage listener below.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== FALLBACK_PORT_NAME) return
  port.onMessage.addListener((message: FallbackPortRequest) => {
    if (message.type !== 'START_FALLBACK') return
    runTavilyFallback(port, message.tabId, message.question)
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

    case 'ASK_QUESTION':
      askQuestion(message.tabId, message.question)
        .then(sendResponse)
        .catch((error) => {
          const response: BackgroundResponse = {
            type: 'ASK_QUESTION_RESULT',
            ok: false,
            message: error instanceof Error ? error.message : 'Unknown error asking question.',
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
