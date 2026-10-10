import { useEffect } from 'react'
import { useAui } from '@assistant-ui/react'
import { pendingSelectionKey } from '../../shared/storageKeys'
import { pageQuote } from '../quote'

// Quotes the selection the context menu left for this tab, whether it arrived before the panel mounted or after.
export function usePendingSelection(tabId: number | null) {
  const aui = useAui()

  useEffect(() => {
    if (tabId === null) return
    const key = pendingSelectionKey(tabId)

    async function take() {
      const stored = await chrome.storage.session.get(key)
      const selection = stored[key]
      if (typeof selection !== 'string' || !selection) return
      await chrome.storage.session.remove(key)
      aui.thread().composer().setQuote(pageQuote(selection))
    }

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && key in changes) take()
    }
    chrome.storage.onChanged.addListener(onChanged)
    take()
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [tabId, aui])
}
