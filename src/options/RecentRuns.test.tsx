import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentTrace } from '../shared/types'
import { RecentRuns } from './RecentRuns'

const trace = (id: string, over: Partial<AgentTrace> = {}): AgentTrace => ({
  id,
  tabId: 1,
  startedAt: '2026-10-01T10:00:00.000Z',
  endedAt: '2026-10-01T10:00:01.000Z',
  status: 'done',
  extensionVersion: '0.0.1',
  question: { length: 12 },
  askedToQuote: false,
  citeRejections: 0,
  forcedNudgeSent: false,
  forcedRetrySent: false,
  rounds: [],
  ...over,
})

const render = (traces: AgentTrace[]) => renderToStaticMarkup(<RecentRuns traces={traces} onRefresh={() => {}} />)

describe('RecentRuns', () => {
  it('shows question text when it was recorded', () => {
    expect(render([trace('a', { question: { length: 5, text: 'why?!' } })])).toContain('why?!')
  })

  it('shows a length placeholder when content was not recorded', () => {
    const html = render([trace('a', { question: { length: 12 } })])

    expect(html).toContain('12 chars (content not recorded)')
  })

  it('lists newest first', () => {
    const html = render([trace('old', { question: { length: 3, text: 'OLD' } }), trace('new', { question: { length: 3, text: 'NEW' } })])

    expect(html.indexOf('NEW')).toBeLessThan(html.indexOf('OLD'))
  })

  it('marks a non-done run distinctly', () => {
    const html = render([trace('a', { status: 'error' })])

    expect(html).toContain('data-status="error"')
    expect(html).toContain('⚠')
  })

  it('says so when there are no runs', () => {
    expect(render([])).toContain('No runs recorded yet.')
  })
})
