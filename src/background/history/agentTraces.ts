import { MAX_TRACE_RUNS } from '../../shared/constants'
import type { AgentTrace } from '../../shared/types'

const TRACES_STORAGE_KEY = 'sift:traces'

export async function getTraces(): Promise<AgentTrace[]> {
  const stored = await chrome.storage.session.get(TRACES_STORAGE_KEY)
  return (stored[TRACES_STORAGE_KEY] as AgentTrace[] | undefined) ?? []
}

// Never rejects: a trace is best-effort, so a quota failure mustn't take the answer down (#18).
export async function appendTrace(trace: AgentTrace): Promise<void> {
  try {
    const existing = await getTraces()
    const updated = [...existing, trace].slice(-MAX_TRACE_RUNS)
    await chrome.storage.session.set({ [TRACES_STORAGE_KEY]: updated })
  } catch (error) {
    console.warn(`[Sift] couldn't persist trace ${trace.id} for tab ${trace.tabId}:`, error)
  }
}
