import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SHARE_LANDING_URL } from '../../shared/shareLanding'
import { openShare } from './openShare'

const events: string[] = []
const set = vi.fn(async () => void events.push('stored'))

beforeEach(() => {
  events.length = 0
  set.mockClear()
  vi.stubGlobal('chrome', { storage: { session: { set } } })
})

const openPanel = vi.fn((tabId: number) => void events.push(`open ${tabId}`))
const message = { type: 'SHARE_OPEN' as const, pageUrl: 'https://a.com/p', pairs: [{ question: 'q', answer: 'a' }] }
const sender = { tab: { id: 4 } as chrome.tabs.Tab, url: `${SHARE_LANDING_URL}#u=x` }

describe('openShare', () => {
  it('opens the panel before it stores anything', async () => {
    expect(await openShare(message, sender, openPanel)).toEqual({ type: 'SHARE_OPENED' })
    expect(events).toEqual(['open 4', 'stored'])
  })

  it.each([
    ['a sender off the landing page', { ...sender, url: 'https://evil.example/' }],
    ['a sender with no tab', { url: sender.url }],
  ])('rejects %s', async (_name, badSender) => {
    expect(await openShare(message, badSender, openPanel)).toEqual({ type: 'SHARE_REJECTED' })
    expect(openPanel).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('rejects a page url that is not http(s) and malformed pairs', async () => {
    expect(await openShare({ ...message, pageUrl: 'javascript:alert(1)' }, sender, openPanel)).toEqual({ type: 'SHARE_REJECTED' })
    expect(await openShare({ ...message, pairs: [{ question: 1 }] as never }, sender, openPanel)).toEqual({ type: 'SHARE_REJECTED' })
    expect(set).not.toHaveBeenCalled()
  })
})
