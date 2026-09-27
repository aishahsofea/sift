import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatTurn } from '../../shared/types'
import { ChatThread } from './ChatThread'

describe('ChatThread', () => {
  const turns: ChatTurn[] = [{ role: 'user', content: 'hello' }]

  it('shows the pending indicator when a label is given', () => {
    const html = renderToStaticMarkup(<ChatThread turns={turns} pendingLabel="Thinking…" />)

    expect(html).toContain('message-bubble-pending')
    expect(html).toContain('Thinking…')
  })

  it('shows no indicator once nothing is pending', () => {
    const html = renderToStaticMarkup(<ChatThread turns={turns} pendingLabel={null} />)

    expect(html).not.toContain('message-bubble-pending')
  })
})
