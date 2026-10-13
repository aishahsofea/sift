import type { ShareLink } from '../../shared/shareSnapshot'
import { describeShare, SHARE_PRIVACY_NOTE, shareOutcome } from '../shareLabel'

interface Props {
  /** Null while the link is being built. */
  result: ShareLink | null
  copied?: boolean
  onCopy: () => void
  onCancel: () => void
}

export function ShareDialog({ result, copied, onCopy, onCancel }: Props) {
  const canCopy = !copied && result !== null && (shareOutcome(result) === 'all' || shareOutcome(result) === 'some')
  return (
    <div role="dialog" aria-label="Share this thread" className="share-dialog">
      <p>{copied ? 'Link copied.' : result ? describeShare(result) : 'Building the link…'}</p>
      {canCopy && <p className="share-dialog-note">{SHARE_PRIVACY_NOTE}</p>}
      <div className="share-dialog-actions">
        <button type="button" onClick={onCancel}>
          {canCopy ? 'Cancel' : 'Close'}
        </button>
        {canCopy && (
          <button type="button" className="share-dialog-confirm" onClick={onCopy}>
            Copy link
          </button>
        )}
      </div>
    </div>
  )
}
