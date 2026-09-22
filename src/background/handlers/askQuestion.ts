import type { BackgroundResponse } from '../../shared/messages'
import { appendHistoryTurns, getExtractedPage, getHistory } from '../history/sessionHistory'
import { getApiKeys } from '../keys'
import { askPageGrounded } from '../nebius/client'
import { assemblePageGroundedMessages } from '../nebius/promptAssembly'

export async function askQuestion(tabId: number, question: string): Promise<BackgroundResponse> {
  const { nebiusApiKey } = await getApiKeys()
  if (!nebiusApiKey) {
    return {
      type: 'ASK_QUESTION_RESULT',
      ok: false,
      message: 'Add your Nebius API key in Options before asking questions.',
    }
  }

  const page = await getExtractedPage(tabId)
  if (!page) {
    return {
      type: 'ASK_QUESTION_RESULT',
      ok: false,
      message: 'No page content available yet. Try reopening the side panel on this tab.',
    }
  }

  const history = await getHistory(tabId)
  const messages = assemblePageGroundedMessages(page, history, question)

  try {
    const result = await askPageGrounded(nebiusApiKey, messages)
    // Only record page-grounded turns here. When found_in_page is false the
    // Tavily fallback pass owns this Q&A pair and appends it once it has a
    // real answer — appending here too would duplicate the question and leave
    // a "not covered on page" filler turn poisoning later prompt history.
    if (result.found_in_page) {
      await appendHistoryTurns(tabId, [
        { role: 'user', content: question },
        { role: 'assistant', content: result.answer, source: 'page' },
      ])
    }
    return { type: 'ASK_QUESTION_RESULT', ok: true, result }
  } catch (error) {
    console.error(`[Sift] askQuestion failed for tab ${tabId}:`, error)
    return {
      type: 'ASK_QUESTION_RESULT',
      ok: false,
      message: error instanceof Error ? error.message : 'Something went wrong asking Nebius.',
    }
  }
}
