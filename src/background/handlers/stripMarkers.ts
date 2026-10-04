// The model sometimes writes a training-time 【cite_page】 marker; it verifies nothing, so strip it (#48).
export function stripCitationMarkers(text: string): string {
  return text
    .replace(/[ \t]*【[^】\n]*】/g, '')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
}
