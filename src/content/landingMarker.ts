import { decodeSnapshot } from '../shared/shareSnapshot'
import type { BackgroundRequest } from '../shared/messages'

// The page watches this attribute to show its "Open with Sift" button.
document.documentElement.dataset.siftInstalled = ''

// Decoded up front: the click handler has to send without awaiting, or the gesture may lapse.
const decoded = await decodeSnapshot(location.hash)

document.addEventListener('click', (event) => {
  if (!decoded.ok || !(event.target as Element).closest('#open-with-sift')) return
  const message: BackgroundRequest = { type: 'SHARE_OPEN', pageUrl: decoded.pageUrl, pairs: decoded.pairs }
  chrome.runtime.sendMessage(message).then((response) => {
    if (response?.type === 'SHARE_OPENED') location.assign(decoded.pageUrl)
  })
})
