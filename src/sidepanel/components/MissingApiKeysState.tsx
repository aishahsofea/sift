export function MissingApiKeysState() {
  return (
    <div role="status" className="missing-api-keys-state">
      <p>Add your Nebius API key in Options to start asking questions.</p>
      <button onClick={() => chrome.runtime.openOptionsPage()}>Open Options</button>
    </div>
  )
}
