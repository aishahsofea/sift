export function SharedThreadBanner({ questions, onDismiss }: { questions: number; onDismiss: () => void }) {
  return (
    <div role="status" className="shared-banner">
      <span>
        Shared thread, read-only ({questions === 1 ? '1 question' : `${questions} questions`}).
      </span>
      <button type="button" onClick={onDismiss}>
        Start my own thread
      </button>
    </div>
  )
}
