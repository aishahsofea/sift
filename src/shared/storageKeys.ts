export const STORAGE_KEYS = {
  nebiusApiKey: 'nebiusApiKey',
  tavilyApiKey: 'tavilyApiKey',
  installId: 'installId',
  traceContentEnabled: 'traceContentEnabled',
  deepModelEnabled: 'deepModelEnabled',
} as const

// A shared thread waiting to be shown read-only in its tab's panel (#87).
export const shareSnapshotKey = (tabId: number): string => `sift:share:${tabId}`

// A page selection waiting for its tab's panel to pick it up as a quote.
export const pendingSelectionKey = (tabId: number): string => `sift:selection:${tabId}`
