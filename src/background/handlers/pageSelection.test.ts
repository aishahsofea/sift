import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_SELECTION_CHARS } from '../../shared/constants'
import { readSelection } from './pageSelection'

function stubInjection(result: () => Promise<unknown>) {
  const executeScript = vi.fn(result)
  vi.stubGlobal('chrome', { scripting: { executeScript } })
  return executeScript
}

afterEach(() => vi.unstubAllGlobals())

describe('readSelection', () => {
  it('reads the selection in the clicked frame, keeping line breaks', async () => {
    const executeScript = stubInjection(async () => [{ result: 'one\ntwo' }])

    expect(await readSelection(7, 3, 'one two')).toBe('one\ntwo')
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7, frameIds: [3] } }))
  })

  it('falls back to selectionText when injection is refused, as on a PDF', async () => {
    stubInjection(async () => {
      throw new Error('Cannot access contents of the page')
    })

    expect(await readSelection(7, 0, 'from the menu')).toBe('from the menu')
  })

  it('falls back to selectionText when the page selection comes back empty', async () => {
    stubInjection(async () => [{ result: '  ' }])

    expect(await readSelection(7, undefined, 'from the menu')).toBe('from the menu')
  })

  it('cuts a long selection with the marker', async () => {
    stubInjection(async () => [{ result: 'x'.repeat(MAX_SELECTION_CHARS + 50) }])

    const selection = await readSelection(7, 0, undefined)

    expect(selection).toBe(`${'x'.repeat(MAX_SELECTION_CHARS)}…`)
  })
})
