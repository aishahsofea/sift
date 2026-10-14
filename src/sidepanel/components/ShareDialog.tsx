import { Icon } from './AssistantThread'
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
          <Icon>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </Icon>
          {canCopy ? 'Cancel' : 'Close'}
        </button>
        {canCopy && (
          <button type="button" className="share-dialog-confirm" onClick={onCopy}>
            <Icon>
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </Icon>
            Copy link
          </button>
        )}
      </div>
    </div>
  )
}
