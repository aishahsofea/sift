import type { AgentStep, ChatTurn, ExtractedPage, UnreadableReason } from './types'

export type BackgroundRequest =
  | { type: 'EXTRACT_PAGE'; tabId: number }
  | { type: 'GET_HISTORY'; tabId: number }
  | { type: 'CLEAR_HISTORY'; tabId: number }
  | { type: 'GET_API_KEY_STATUS' }

export type BackgroundResponse =
  | { type: 'EXTRACT_PAGE_RESULT'; ok: true; page: ExtractedPage }
  | { type: 'EXTRACT_PAGE_RESULT'; ok: false; reason: UnreadableReason; message: string }
  | { type: 'HISTORY_RESULT'; turns: ChatTurn[] }
  | { type: 'CLEARED' }
  | { type: 'API_KEY_STATUS'; nebiusConfigured: boolean; tavilyConfigured: boolean }

// content script -> background: correlated via sender.tab.id, NOT a self-reported field
// (a content script has no chrome.tabs access, so it structurally cannot supply its own tabId)
export type ContentScriptMessage =
  | { type: 'PAGE_EXTRACTED'; page: ExtractedPage }
  | { type: 'PAGE_EXTRACTION_FAILED'; reason: UnreadableReason; message: string }

// Every question runs over this port (ADR 0001): the loop can take several
// rounds, and step events have to reach the panel while it does, which a
// one-shot sendMessage response can't express.
export const ASK_PORT_NAME = 'sift-ask'

export type AskPortRequest = { type: 'START_ASK'; tabId: number; question: string }

export type AskPortMessage =
  | { type: 'ASK_STEP'; step: AgentStep }
  | { type: 'ASK_CHUNK'; delta: string }
  | { type: 'ASK_DONE'; fullText: string; source: NonNullable<ChatTurn['source']> }
  | { type: 'ASK_ERROR'; message: string }
