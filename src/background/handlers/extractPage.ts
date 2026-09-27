import type { BackgroundResponse, ContentScriptMessage } from '../../shared/messages'
import type { UnreadableReason } from '../../shared/types'
import { setExtractedPage } from '../history/sessionHistory'

const EXTRACTION_TIMEOUT_MS = 5000

export async function extractPage(tabId: number): Promise<BackgroundResponse> {
  // Registered before executeScript, not after: the injected script's synchronous
  // top-level code (including its sendMessage call) can finish before executeScript's
  // own promise resolves, so a listener added afterward can miss the message entirely.
  const pending = createContentScriptMessageWaiter(tabId)

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js'],
    })
  } catch (error) {
    pending.cancel()
    console.error(`[Sift] executeScript failed for tab ${tabId}:`, error)
    return { type: 'EXTRACT_PAGE_RESULT', ok: false, ...classifyInjectionError(error) }
  }

  const result = await pending.promise

  if (result.type === 'TIMEOUT') {
    console.error(`[Sift] Timed out waiting for content script response from tab ${tabId}`)
    return {
      type: 'EXTRACT_PAGE_RESULT',
      ok: false,
      reason: 'unknown-error',
      message: 'Timed out waiting for page extraction.',
    }
  }

  if (result.type === 'PAGE_EXTRACTION_FAILED') {
    console.error(`[Sift] Content script reported failure for tab ${tabId}:`, result.reason, result.message)
    return { type: 'EXTRACT_PAGE_RESULT', ok: false, reason: result.reason, message: result.message }
  }

  // Stored first: it says whether the whole text was kept, which the log line and the
  // panel both report. The page it returns is the head only — the whole text stays here.
  const page = await setExtractedPage(tabId, result.page, result.fullContent)
  console.log(
    `[Sift] Extracted page for tab ${tabId}: "${page.title}" via ${page.extractionMethod}, ${page.content.length} chars${page.truncated ? ` (truncated, ${page.charsOmitted} more ${page.searchable ? 'kept for search_page' : 'not kept'})` : ''}${page.byline ? ', byline found' : ''}`,
  )
  return { type: 'EXTRACT_PAGE_RESULT', ok: true, page }
}

interface ContentScriptMessageWaiter {
  promise: Promise<ContentScriptMessage | { type: 'TIMEOUT' }>
  cancel: () => void
}

function createContentScriptMessageWaiter(tabId: number): ContentScriptMessageWaiter {
  let listener: (message: ContentScriptMessage, sender: chrome.runtime.MessageSender) => void = () => {}
  let timeout: ReturnType<typeof setTimeout>

  const promise = new Promise<ContentScriptMessage | { type: 'TIMEOUT' }>((resolve) => {
    timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener)
      resolve({ type: 'TIMEOUT' })
    }, EXTRACTION_TIMEOUT_MS)

    listener = (message, sender) => {
      if (sender.tab?.id !== tabId) return
      if (message.type !== 'PAGE_EXTRACTED' && message.type !== 'PAGE_EXTRACTION_FAILED') return
      clearTimeout(timeout)
      chrome.runtime.onMessage.removeListener(listener)
      resolve(message)
    }

    chrome.runtime.onMessage.addListener(listener)
  })

  return {
    promise,
    cancel: () => {
      clearTimeout(timeout)
      chrome.runtime.onMessage.removeListener(listener)
    },
  }
}

function classifyInjectionError(error: unknown): { reason: UnreadableReason; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()

  if (
    lower.includes('cannot access a chrome') ||
    lower.includes('cannot access contents of the page') ||
    lower.includes('chrome web store') ||
    lower.includes('extension gallery') ||
    lower.includes('chrome://') ||
    lower.includes('about:') ||
    lower.includes('chrome-extension://')
  ) {
    return { reason: 'restricted-url', message }
  }

  if (lower.includes('no tab with id') || lower.includes('cannot be scripted')) {
    return { reason: 'permission-denied', message }
  }

  if (lower.includes('content security policy') || lower.includes('csp')) {
    return { reason: 'csp-blocked', message }
  }

  return { reason: 'unknown-error', message }
}
