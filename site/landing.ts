import { decodeSnapshot, type SharedPair } from '../src/shared/shareSnapshot'

const $ = (id: string) => document.getElementById(id)!

function render(pageUrl: string, pairs: SharedPair[]) {
  const page = $('page')
  if (/^https?:\/\//.test(pageUrl)) {
    const link = Object.assign(document.createElement('a'), {
      href: pageUrl,
      textContent: pageUrl,
      rel: 'noreferrer noopener',
    })
    page.append('About ', link)
    page.hidden = false
  }

  const thread = $('thread')
  for (const { question, answer, quotes } of pairs) {
    const pair = Object.assign(document.createElement('section'), { className: 'pair' })
    pair.append(
      Object.assign(document.createElement('p'), { className: 'q', textContent: question }),
      Object.assign(document.createElement('p'), { className: 'a', textContent: answer }),
    )
    for (const quote of quotes ?? []) {
      pair.append(Object.assign(document.createElement('blockquote'), { textContent: quote }))
    }
    thread.append(pair)
  }
}

const decoded = await decodeSnapshot(location.hash)
if (decoded.ok) {
  render(decoded.pageUrl, decoded.pairs)
} else {
  const error = $('error')
  error.textContent = decoded.error
  error.hidden = false
}
