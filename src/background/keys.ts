import { DEMO_PROXY_URL } from '../shared/constants'
import { STORAGE_KEYS } from '../shared/storageKeys'

export interface ApiKeys {
  nebiusApiKey: string | undefined
  tavilyApiKey: string | undefined
  /** Set only when the key is the install ID and the call goes to the demo proxy. */
  nebiusBaseUrl?: string
  tavilyBaseUrl?: string
  /** The user opted into the deep model. Never set on the demo proxy, whose daily caps assume Nano. */
  deepModel?: boolean
}

// Saved keys win; with none and a proxy built in, the install ID stands in (#39).
export async function getApiKeys(): Promise<ApiKeys> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.nebiusApiKey, STORAGE_KEYS.tavilyApiKey, STORAGE_KEYS.deepModelEnabled])
  const nebiusApiKey = (stored[STORAGE_KEYS.nebiusApiKey] as string | undefined) || undefined
  const tavilyApiKey = (stored[STORAGE_KEYS.tavilyApiKey] as string | undefined) || undefined
  const deepModel = Boolean(stored[STORAGE_KEYS.deepModelEnabled]) && Boolean(nebiusApiKey)
  if (!DEMO_PROXY_URL || (nebiusApiKey && tavilyApiKey)) return { nebiusApiKey, tavilyApiKey, deepModel }

  const installId = await getInstallId()
  return {
    nebiusApiKey: nebiusApiKey ?? installId,
    tavilyApiKey: tavilyApiKey ?? installId,
    deepModel,
    ...(nebiusApiKey ? {} : { nebiusBaseUrl: `${DEMO_PROXY_URL}/nebius` }),
    ...(tavilyApiKey ? {} : { tavilyBaseUrl: `${DEMO_PROXY_URL}/tavily` }),
  }
}

// A random ID, not an identity: it only lets the proxy count one install's calls.
async function getInstallId(): Promise<string> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.installId)
  const existing = stored[STORAGE_KEYS.installId] as string | undefined
  if (existing) return existing
  const id = crypto.randomUUID()
  await chrome.storage.local.set({ [STORAGE_KEYS.installId]: id })
  return id
}

export async function getTraceContentEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.traceContentEnabled)
  return (stored[STORAGE_KEYS.traceContentEnabled] as boolean | undefined) ?? false
}
