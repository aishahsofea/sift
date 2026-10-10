export const STORAGE_KEYS = {
  nebiusApiKey: 'nebiusApiKey',
  tavilyApiKey: 'tavilyApiKey',
  installId: 'installId',
  traceContentEnabled: 'traceContentEnabled',
} as const

// A page selection waiting for its tab's panel to pick it up as a quote.
export const pendingSelectionKey = (tabId: number): string => `sift:selection:${tabId}`
