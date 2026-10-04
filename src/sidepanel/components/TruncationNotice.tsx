import { describeTruncatedPage } from '../truncationLabel'

// Shown before the first question so the user knows the page is a fragment (#12) and what's reachable.
export function TruncationNotice({ charsOmitted, searchable }: { charsOmitted: number; searchable: boolean }) {
  return (
    <div role="status" aria-live="polite" className="truncation-notice">
      <strong>Long page.</strong> {describeTruncatedPage(charsOmitted, searchable)}
    </div>
  )
}
