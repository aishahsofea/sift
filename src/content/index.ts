import { Readability, isProbablyReaderable } from '@mozilla/readability'
import { truncate } from '../shared/truncate'
import type { ExtractedPage, UnreadableReason } from '../shared/types'
import type { ContentScriptMessage } from '../shared/messages'

type ExtractionFailure = { reason: UnreadableReason; message: string }

function extract(): ExtractedPage | ExtractionFailure {
  try {
    // .parse() mutates the document it's given, so hand it a clone and keep
    // the live document untouched for the innerText fallback below.
    const clone = document.cloneNode(true) as Document

    let title = document.title
    let content = ''
    let extractionMethod: ExtractedPage['extractionMethod'] = 'raw-text'

    if (isProbablyReaderable(clone)) {
      const article = new Readability(clone).parse()
      if (article?.textContent?.trim()) {
        title = article.title?.trim() || title
        content = article.textContent.trim()
        extractionMethod = 'readability'
      }
    }

    if (!content) {
      content = document.body?.innerText?.trim() ?? ''
    }

    if (!content) {
      return { reason: 'no-content', message: 'No readable text found on this page.' }
    }

    const { content: truncatedContent, truncated } = truncate(content)

    return {
      url: document.URL,
      title,
      content: truncatedContent,
      extractionMethod,
      truncated,
    }
  } catch (error) {
    return {
      reason: 'unknown-error',
      message: error instanceof Error ? error.message : 'Unknown extraction error.',
    }
  }
}

function isFailure(result: ExtractedPage | ExtractionFailure): result is ExtractionFailure {
  return 'reason' in result
}

const result = extract()

const message: ContentScriptMessage = isFailure(result)
  ? { type: 'PAGE_EXTRACTION_FAILED', reason: result.reason, message: result.message }
  : { type: 'PAGE_EXTRACTED', page: result }

chrome.runtime.sendMessage(message)
