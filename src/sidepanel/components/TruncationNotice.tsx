import { describeTruncatedPage } from '../truncationLabel'

// Shown on reading a truncated page, before the first question, so the user knows it's a fragment (#12) and whether the rest is reachable (#11).
export function TruncationNotice({ charsOmitted, searchable }: { charsOmitted: number; searchable: boolean }) {
  return (
    <div role="status" aria-live="polite" className="truncation-notice">
      <strong>Long page.</strong> {describeTruncatedPage(charsOmitted, searchable)}
    </div>
  )
}
