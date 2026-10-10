import type { AgentStep, ChatTurn, ExtractedPage, UnreadableReason } from './types'

export type BackgroundRequest =
  | { type: 'EXTRACT_PAGE'; tabId: number }
  | { type: 'GET_HISTORY'; tabId: number }
  | { type: 'CLEAR_HISTORY'; tabId: number }
  | { type: 'GET_API_KEY_STATUS' }
  | { type: 'OPEN_QUOTE'; tabId: number; quote: string; url?: string }

export type BackgroundResponse =
  | { type: 'EXTRACT_PAGE_RESULT'; ok: true; page: ExtractedPage }
  | { type: 'EXTRACT_PAGE_RESULT'; ok: false; reason: UnreadableReason; message: string }
  | { type: 'HISTORY_RESULT'; turns: ChatTurn[] }
  | { type: 'CLEARED' }
  | { type: 'QUOTE_OPENED' }
  | { type: 'API_KEY_STATUS'; nebiusConfigured: boolean; tavilyConfigured: boolean }

// content script -> background, correlated via sender.tab.id since a content script can't supply its tabId.
export type ContentScriptMessage =
  // The whole extracted text, sent only when `page` is a cut head and the whole is small enough (#11).
  | { type: 'PAGE_EXTRACTED'; page: ExtractedPage; fullContent?: string }
  | { type: 'PAGE_EXTRACTION_FAILED'; reason: UnreadableReason; message: string }

// Every question runs over this port (ADR 0001): step events must reach the panel mid-loop.
export const ASK_PORT_NAME = 'sift-ask'

// `rewind` drops that many turns from the end of history first: an edited question replaces its turn (#46).
// `selection` is page text the user quoted with the question.
export type AskPortRequest = { type: 'START_ASK'; tabId: number; question: string; rewind?: number; selection?: string }

export type AskPortMessage =
  | { type: 'ASK_STEP'; step: AgentStep }
  | { type: 'ASK_CHUNK'; delta: string }
  // The turn exactly as stored in history, so live and reloaded answers match; traceId ties it to its trace.
  | { type: 'ASK_DONE'; turn: ChatTurn; traceId: string }
  | { type: 'ASK_ERROR'; message: string; traceId: string }
