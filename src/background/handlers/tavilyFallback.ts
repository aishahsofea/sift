import type { FallbackPortMessage } from '../../shared/messages'
import { appendHistoryTurns, getExtractedPage, getHistory } from '../history/sessionHistory'
import { getApiKeys } from '../keys'
import { streamFallbackAnswer } from '../nebius/client'
import { assembleFallbackMessages } from '../nebius/promptAssembly'
import { searchTavily } from '../tavily/client'

export async function runTavilyFallback(port: chrome.runtime.Port, tabId: number, question: string): Promise<void> {
  try {
    const { nebiusApiKey, tavilyApiKey } = await getApiKeys()
    if (!nebiusApiKey || !tavilyApiKey) {
      post(port, {
        type: 'FALLBACK_ERROR',
        message: 'Add your Nebius and Tavily API keys in Options to search the web.',
      })
      return
    }

    const page = await getExtractedPage(tabId)
    if (!page) {
      post(port, {
        type: 'FALLBACK_ERROR',
        message: 'No page content available yet. Try reopening the side panel on this tab.',
      })
      return
    }

    const [history, searchResults] = await Promise.all([
      getHistory(tabId),
      searchTavily(tavilyApiKey, question, page.url, page.title),
    ])

    const messages = assembleFallbackMessages(page, history, question, searchResults)

    const fullText = await streamFallbackAnswer(nebiusApiKey, messages, (delta) => {
      post(port, { type: 'FALLBACK_CHUNK', delta })
    })

    await appendHistoryTurns(tabId, [
      { role: 'user', content: question },
      { role: 'assistant', content: fullText, source: 'web' },
    ])

    post(port, { type: 'FALLBACK_DONE', fullText })
  } catch (error) {
    console.error(`[Sift] tavilyFallback failed for tab ${tabId}:`, error)
    post(port, {
      type: 'FALLBACK_ERROR',
      message: error instanceof Error ? error.message : 'Something went wrong searching the web.',
    })
  }
}

function post(port: chrome.runtime.Port, message: FallbackPortMessage): void {
  port.postMessage(message)
}
