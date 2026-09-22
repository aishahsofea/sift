import { useEffect, useState } from 'react'
import { STORAGE_KEYS } from '../shared/storageKeys'

export default function App() {
  const [nebiusApiKey, setNebiusApiKey] = useState('')
  const [tavilyApiKey, setTavilyApiKey] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    chrome.storage.local
      .get([STORAGE_KEYS.nebiusApiKey, STORAGE_KEYS.tavilyApiKey])
      .then((stored) => {
        setNebiusApiKey((stored[STORAGE_KEYS.nebiusApiKey] as string) ?? '')
        setTavilyApiKey((stored[STORAGE_KEYS.tavilyApiKey] as string) ?? '')
      })
  }, [])

  const handleSave = async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.nebiusApiKey]: nebiusApiKey,
      [STORAGE_KEYS.tavilyApiKey]: tavilyApiKey,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 480 }}>
      <h1>Sift Options</h1>
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
      <button onClick={handleSave}>Save</button>
      {saved && <span style={{ marginLeft: '0.75rem' }}>Saved</span>}
    </main>
  )
}
