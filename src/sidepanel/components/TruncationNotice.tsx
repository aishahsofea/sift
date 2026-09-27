import { describeTruncatedPage } from '../truncationLabel'

// Shown as soon as a truncated page is read, before the first question: the user
// should know Sift is holding a fragment before they rely on an answer (#12), and
// whether it can reach the rest (#11).
export function TruncationNotice({ charsOmitted, searchable }: { charsOmitted: number; searchable: boolean }) {
  return (
    <div role="status" aria-live="polite" className="truncation-notice">
      <strong>Long page.</strong> {describeTruncatedPage(charsOmitted, searchable)}
    </div>
  )
}
