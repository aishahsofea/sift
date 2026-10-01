import { STORAGE_KEYS } from '../shared/storageKeys'

export interface ApiKeys {
  nebiusApiKey: string | undefined
  tavilyApiKey: string | undefined
}

export async function getApiKeys(): Promise<ApiKeys> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.nebiusApiKey, STORAGE_KEYS.tavilyApiKey])
  return {
    nebiusApiKey: (stored[STORAGE_KEYS.nebiusApiKey] as string | undefined) || undefined,
    tavilyApiKey: (stored[STORAGE_KEYS.tavilyApiKey] as string | undefined) || undefined,
  }
}

export async function getTraceContentEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.traceContentEnabled)
  return (stored[STORAGE_KEYS.traceContentEnabled] as boolean | undefined) ?? false
}
