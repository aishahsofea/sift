import type { ChatTurn, ExtractedPage, PageGroundedResult, UnreadableReason } from './types'

export type BackgroundRequest =
  | { type: 'EXTRACT_PAGE'; tabId: number }
  | { type: 'ASK_QUESTION'; tabId: number; question: string }
  | { type: 'GET_HISTORY'; tabId: number }
  | { type: 'CLEAR_HISTORY'; tabId: number }
  | { type: 'GET_API_KEY_STATUS' }

export type BackgroundResponse =
  | { type: 'EXTRACT_PAGE_RESULT'; ok: true; page: ExtractedPage }
  | { type: 'EXTRACT_PAGE_RESULT'; ok: false; reason: UnreadableReason; message: string }
  | { type: 'ASK_QUESTION_RESULT'; ok: true; result: PageGroundedResult }
  | { type: 'ASK_QUESTION_RESULT'; ok: false; message: string }
  | { type: 'HISTORY_RESULT'; turns: ChatTurn[] }
  | { type: 'CLEARED' }
  | { type: 'API_KEY_STATUS'; nebiusConfigured: boolean; tavilyConfigured: boolean }

// content script -> background: correlated via sender.tab.id, NOT a self-reported field
// (a content script has no chrome.tabs access, so it structurally cannot supply its own tabId)
export type ContentScriptMessage =
  | { type: 'PAGE_EXTRACTED'; page: ExtractedPage }
  | { type: 'PAGE_EXTRACTION_FAILED'; reason: UnreadableReason; message: string }

// streaming port protocol — Tavily-fallback pass ONLY, page-grounded pass never uses this
export const FALLBACK_PORT_NAME = 'sift-fallback'

export type FallbackPortRequest = { type: 'START_FALLBACK'; tabId: number; question: string }

export type FallbackPortMessage =
  | { type: 'FALLBACK_CHUNK'; delta: string }
  | { type: 'FALLBACK_DONE'; fullText: string }
  | { type: 'FALLBACK_ERROR'; message: string }
