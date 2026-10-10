// Injected with chrome.scripting.executeScript({ func }), which serializes it: no imports, helpers stay inside.
export function highlightQuote(quote: string): boolean {
  const NAME = 'sift-quote'
  const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'])

  const target = quote.replace(/\s+/g, ' ').trim()
  if (!target) return false

  const textNodes: Text[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const visible = new Map<Element, boolean>()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!parent || SKIPPED.has(parent.tagName)) continue
    if (!visible.has(parent)) visible.set(parent, parent.checkVisibility?.() !== false)
    if (visible.get(parent)) textNodes.push(node as Text)
  }

  // Whitespace-collapsed page text with each char mapped back to its node and offset, so a match can span nodes.
  function index(spaceBetweenNodes: boolean) {
    let text = ''
    const nodes: Text[] = []
    const offsets: number[] = []
    for (const node of textNodes) {
      if (spaceBetweenNodes && text && !text.endsWith(' ')) {
        text += ' '
        nodes.push(node)
        offsets.push(0)
      }
      const data = node.data
      for (let i = 0; i < data.length; i++) {
        const space = /\s/.test(data[i])
        if (space && (!text || text.endsWith(' '))) continue
        text += space ? ' ' : data[i]
        nodes.push(node)
        offsets.push(i)
      }
    }
    return { text, nodes, offsets }
  }

  // Readability joins blocks with no separator, innerText with a newline: try both.
  for (const spaceBetweenNodes of [false, true]) {
    const { text, nodes, offsets } = index(spaceBetweenNodes)
    const start = text.indexOf(target)
    if (start === -1) continue

    const last = start + target.length - 1
    const range = document.createRange()
    range.setStart(nodes[start], offsets[start])
    range.setEnd(nodes[last], offsets[last] + 1)

    CSS.highlights.set(NAME, new Highlight(range))
    nodes[start].parentElement?.scrollIntoView({ block: 'center' })
    return true
  }
  return false
}
