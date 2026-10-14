import { useCallback, useEffect, useState } from 'react'
import type { ShareSnapshot } from '../../shared/shareSnapshot'
import { shareSnapshotKey } from '../../shared/storageKeys'

export type SharedSnapshotState = { state: 'loading' } | { state: 'none' } | { state: 'shared'; snapshot: ShareSnapshot }

// The landing page's handoff can land after the panel opens, so this follows the storage key rather than reading it once.
export function useSharedSnapshot(tabId: number | null): { shared: SharedSnapshotState; dismiss: () => void } {
  const [shared, setShared] = useState<SharedSnapshotState>(tabId === null ? { state: 'none' } : { state: 'loading' })

  useEffect(() => {
    if (tabId === null) return
    const key = shareSnapshotKey(tabId)
    const apply = (snapshot: ShareSnapshot | undefined) => setShared(snapshot ? { state: 'shared', snapshot } : { state: 'none' })

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'session' && key in changes) apply(changes[key].newValue as ShareSnapshot | undefined)
    }
    chrome.storage.onChanged.addListener(onChanged)
    chrome.storage.session.get(key).then((stored) => apply(stored[key] as ShareSnapshot | undefined))
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [tabId])

  const dismiss = useCallback(() => {
    if (tabId !== null) chrome.storage.session.remove(shareSnapshotKey(tabId))
  }, [tabId])

  return { shared, dismiss }
}
