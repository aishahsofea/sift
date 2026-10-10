import { afterEach, describe, expect, it, vi } from 'vitest'
import { openQuote } from './openQuote'

const PAGE = 'https://a.com/post'

function stubChrome({ tabUrl = PAGE, matched = true, injectionFails = false } = {}) {
  const chromeStub = {
    tabs: { get: vi.fn(async () => ({ url: tabUrl })), create: vi.fn(async () => ({})) },
    scripting: {
      insertCSS: vi.fn(async () => undefined),
      executeScript: vi.fn(async () => {
        if (injectionFails) throw new Error('Cannot access contents of the page')
        return [{ result: matched }]
      }),
    },
  }
  vi.stubGlobal('chrome', chromeStub)
  return chromeStub
}

afterEach(() => vi.unstubAllGlobals())

describe('openQuote', () => {
  it('highlights in place when the tab is still on the turn\'s page', async () => {
    const chrome = stubChrome()

    await openQuote(1, 'a quote', PAGE)

    expect(chrome.scripting.insertCSS).toHaveBeenCalled()
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ args: ['a quote'] }))
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('ignores the hash when comparing pages', async () => {
    const chrome = stubChrome({ tabUrl: `${PAGE}#section` })

    await openQuote(1, 'a quote', PAGE)

    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('opens a text-fragment tab when the quote is not found', async () => {
    const chrome = stubChrome({ matched: false })

    await openQuote(1, 'a quote', PAGE)

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: `${PAGE}#:~:text=a%20quote`, active: true })
  })

  it('opens a text-fragment tab without injecting when the tab has moved on', async () => {
    const chrome = stubChrome({ tabUrl: 'https://b.com/other' })

    await openQuote(1, 'a quote', PAGE)

    expect(chrome.scripting.executeScript).not.toHaveBeenCalled()
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: `${PAGE}#:~:text=a%20quote`, active: true })
  })

  it('opens a text-fragment tab when injection is refused', async () => {
    const chrome = stubChrome({ injectionFails: true })

    await openQuote(1, 'a quote', PAGE)

    expect(chrome.tabs.create).toHaveBeenCalled()
  })

  it('does nothing on a miss when the turn has no stored url', async () => {
    const chrome = stubChrome({ matched: false })

    await openQuote(1, 'a quote')

    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('still highlights when the turn has no stored url', async () => {
    const chrome = stubChrome({ tabUrl: 'https://anything.com' })

    await openQuote(1, 'a quote')

    expect(chrome.scripting.executeScript).toHaveBeenCalled()
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })

  it('stays quiet when the tab is gone', async () => {
    const chrome = stubChrome()
    chrome.tabs.get.mockRejectedValue(new Error('No tab with id'))

    await expect(openQuote(1, 'a quote', PAGE)).resolves.toBeUndefined()
    expect(chrome.tabs.create).not.toHaveBeenCalled()
  })
})
