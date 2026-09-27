// A dedicated indicator, not a fake message: its text is status, not an answer, so
// it doesn't go through ReactMarkdown and can't be mistaken for a finished bubble.
export function PendingIndicator({ label }: { label: string }) {
  return (
    <div className="message-bubble message-bubble-pending">
      <span className="pending-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span role="status">{label}</span>
    </div>
  )
}
