import type { UnreadableReason } from '../../shared/types'

interface UnreadablePageStateProps {
  reason: UnreadableReason
  message: string
}

const REASON_LABELS: Record<UnreadableReason, string> = {
  'restricted-url': "Sift can't read this page.",
  'csp-blocked': 'This page blocks content scripts.',
  'permission-denied': 'Click the Sift toolbar icon again on this tab to re-enable it.',
  'no-content': 'No readable content was found on this page.',
  'unknown-error': 'Something went wrong reading this page.',
}

export function UnreadablePageState({ reason, message }: UnreadablePageStateProps) {
  return (
    <div role="status" aria-live="polite" className="unreadable-page-state">
      <p>{REASON_LABELS[reason]}</p>
      <p className="unreadable-page-state-detail">{message}</p>
    </div>
  )
}
