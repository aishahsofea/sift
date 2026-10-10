import { ASK_PORT_NAME, type AskPortRequest, type BackgroundRequest, type BackgroundResponse } from '../shared/messages'
import { runAgentLoop } from './handlers/agentLoop'
import { extractPage } from './handlers/extractPage'
import { readSelection } from './handlers/pageSelection'
import { clearHistory, clearTabData, getHistory, setPendingSelection } from './history/sessionHistory'
import { getApiKeys } from './keys'

const SIDE_PANEL_PATH = 'src/sidepanel/index.html'

const ASK_SELECTION_MENU_ID = 'sift-ask-selection'

// Tab-scoped (#14): the panel opens here with `?tabId=`; setOptions isn't awaited so open() stays sync.
function openPanel(tabId: number) {
  chrome.sidePanel
    .setOptions({ tabId, path: `${SIDE_PANEL_PATH}?tabId=${tabId}`, enabled: true })
    .catch((error) => console.error(`[Sift] Failed to configure side panel for tab ${tabId}:`, error))
  chrome.sidePanel
    .open({ tabId })
    .catch((error) => console.error(`[Sift] Failed to open side panel for tab ${tabId}:`, error))
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) openPanel(tab.id)
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: ASK_SELECTION_MENU_ID, title: 'Ask Sift about this selection', contexts: ['selection'] })
})

// Opens the panel first and synchronously, while the click's user gesture still counts.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== ASK_SELECTION_MENU_ID || tab?.id === undefined) return
  const tabId = tab.id
  openPanel(tabId)
  readSelection(tabId, info.frameId, info.selectionText)
    .then((selection) => (selection ? setPendingSelection(tabId, selection) : undefined))
    .catch((error) => console.error(`[Sift] couldn't pass the selection to tab ${tabId}:`, error))
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
    runAgentLoop(port, message.tabId, message.question, message.rewind, message.selection)
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
