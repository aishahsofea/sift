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
  // `fullContent` is the whole extracted text, sent only when `page` is the cut-short
  // head of it and the whole is small enough to keep (#11). The background stores it
  // apart from `page`, so the page the panel and the prompt read stays the size it was.
  | { type: 'PAGE_EXTRACTED'; page: ExtractedPage; fullContent?: string }
  | { type: 'PAGE_EXTRACTION_FAILED'; reason: UnreadableReason; message: string }

// Every question runs over this port (ADR 0001): the loop can take several
// rounds, and step events have to reach the panel while it does, which a
// one-shot sendMessage response can't express.
export const ASK_PORT_NAME = 'sift-ask'

// `rewind` drops that many turns from the end of stored history before asking: an edited
// question replaces its turn and everything after it (#46).
export type AskPortRequest = { type: 'START_ASK'; tabId: number; question: string; rewind?: number }

export type AskPortMessage =
  | { type: 'ASK_STEP'; step: AgentStep }
  | { type: 'ASK_CHUNK'; delta: string }
  // The assistant turn exactly as stored in history, so a live answer and a reloaded one match.
  // traceId ties each outcome to its AgentTrace (#18).
  | { type: 'ASK_DONE'; turn: ChatTurn; traceId: string }
  | { type: 'ASK_ERROR'; message: string; traceId: string }
