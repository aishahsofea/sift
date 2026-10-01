import { useEffect, useState } from 'react'
import { getTraces } from '../background/history/agentTraces'
import type { AgentTrace } from '../shared/types'
import { DEMO_PROXY_URL } from '../shared/constants'
import { STORAGE_KEYS } from '../shared/storageKeys'
import { RecentRuns } from './RecentRuns'

export default function App() {
  const [nebiusApiKey, setNebiusApiKey] = useState('')
  const [tavilyApiKey, setTavilyApiKey] = useState('')
  const [traceContentEnabled, setTraceContentEnabled] = useState(false)
  const [saved, setSaved] = useState(false)
  const [traces, setTraces] = useState<AgentTrace[]>([])

  const refreshTraces = () => {
    getTraces().then(setTraces, () => setTraces([]))
  }

  useEffect(refreshTraces, [])

  useEffect(() => {
    chrome.storage.local
      .get([STORAGE_KEYS.nebiusApiKey, STORAGE_KEYS.tavilyApiKey, STORAGE_KEYS.traceContentEnabled])
      .then((stored) => {
        setNebiusApiKey((stored[STORAGE_KEYS.nebiusApiKey] as string) ?? '')
        setTavilyApiKey((stored[STORAGE_KEYS.tavilyApiKey] as string) ?? '')
        setTraceContentEnabled((stored[STORAGE_KEYS.traceContentEnabled] as boolean) ?? false)
      })
  }, [])

  const handleSave = async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.nebiusApiKey]: nebiusApiKey,
      [STORAGE_KEYS.tavilyApiKey]: tavilyApiKey,
      [STORAGE_KEYS.traceContentEnabled]: traceContentEnabled,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 480 }}>
      <h1>Sift Options</h1>
      {DEMO_PROXY_URL && (
        <p>
          Leave a key blank to use Sift's shared demo for that service (daily limits apply). Your page text and questions go through the demo
          server to reach Nebius and Tavily. Add your own key to talk to the provider directly.
        </p>
      )}
      <label style={{ display: 'block', marginBottom: '1rem' }}>
        Nebius API key
        <input
          type="password"
          value={nebiusApiKey}
          onChange={(e) => setNebiusApiKey(e.target.value)}
          style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: '1rem' }}>
        Tavily API key
        <input
          type="password"
          value={tavilyApiKey}
          onChange={(e) => setTavilyApiKey(e.target.value)}
          style={{ display: 'block', width: '100%', marginTop: '0.25rem' }}
        />
      </label>
      <label style={{ display: 'block', marginBottom: '1rem' }}>
        <input
          type="checkbox"
          checked={traceContentEnabled}
          onChange={(e) => setTraceContentEnabled(e.target.checked)}
          style={{ marginRight: '0.5rem' }}
        />
        Record question/answer text in run traces
      </label>
      <button onClick={handleSave}>Save</button>
      {saved && <span style={{ marginLeft: '0.75rem' }}>Saved</span>}
      <RecentRuns traces={traces} onRefresh={refreshTraces} />
    </main>
  )
}
