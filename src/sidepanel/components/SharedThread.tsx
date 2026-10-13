import { useMemo } from 'react'
import { pairsToTurns, type ShareSnapshot } from '../../shared/shareSnapshot'
import { AssistantThread } from './AssistantThread'
import { SharedThreadBanner } from './SharedThreadBanner'
import { SiftRuntimeProvider } from './SiftRuntimeProvider'

const noop = () => {}

// Renders a shared snapshot without touching the tab's history: no extraction, no composer, nothing to ask with.
export function SharedThread({ snapshot, tabId, onDismiss }: { snapshot: ShareSnapshot; tabId: number | null; onDismiss: () => void }) {
  const turns = useMemo(() => pairsToTurns(snapshot), [snapshot])
  return (
    <SiftRuntimeProvider turns={turns} isRunning={false} onAsk={noop} onReload={noop} onStop={() => ({ question: '' })}>
      <SharedThreadBanner questions={snapshot.pairs.length} onDismiss={onDismiss} />
      <AssistantThread pending={null} tabId={tabId} readOnly />
    </SiftRuntimeProvider>
  )
}
