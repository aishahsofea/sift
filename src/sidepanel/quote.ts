import type { QuoteInfo } from '@assistant-ui/react'

// assistant-ui requires a source message id; a page selection has none.
export const pageQuote = (text: string): QuoteInfo => ({ text, messageId: 'page' })

// The quote a composer attached to a message, if any.
export function quoteText(message: { metadata: { custom?: Record<string, unknown> } }): string | undefined {
  const quote = message.metadata.custom?.quote as Partial<QuoteInfo> | undefined
  return quote?.text || undefined
}
