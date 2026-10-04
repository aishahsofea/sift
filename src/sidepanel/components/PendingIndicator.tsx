// Not a fake message: its text is status, so it skips ReactMarkdown and can't pass for a finished bubble.
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
