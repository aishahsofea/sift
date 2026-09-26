import { describeTruncatedPage } from '../truncationLabel'

// Shown as soon as a truncated page is read, before the first question: the user
// should know Sift is holding a fragment before they rely on an answer (#12).
export function TruncationNotice({ charsOmitted }: { charsOmitted: number }) {
  return (
    <div role="status" aria-live="polite" className="truncation-notice">
      <strong>Long page.</strong> {describeTruncatedPage(charsOmitted)}
    </div>
  )
}
