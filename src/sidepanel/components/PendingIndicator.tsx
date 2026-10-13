// Not a fake message: its text is status, so it skips ReactMarkdown and can't pass for a finished bubble.
export function PendingIndicator({ label, done = [] }: { label: string; done?: string[] }) {
  return (
    <div className="message-bubble message-bubble-pending">
      {done.length > 0 && (
        <ol className="pending-steps">
          {done.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
      <div className="pending-current">
        <span className="pending-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span role="status">{label}</span>
      </div>
    </div>
  )
}
