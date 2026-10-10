import { capSelection } from '../../shared/truncate'

// Reads in the clicked frame to keep line breaks; selectionText (whitespace-collapsed) covers PDFs and pages that refuse injection.
export async function readSelection(tabId: number, frameId: number | undefined, selectionText: string | undefined): Promise<string> {
  let text = ''
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId ?? 0] },
      func: () => getSelection()?.toString() ?? '',
    })
    text = typeof injection?.result === 'string' ? injection.result : ''
  } catch {
    // fall through to selectionText
  }
  return capSelection(text.trim() ? text : (selectionText ?? '')).text.trim()
}
