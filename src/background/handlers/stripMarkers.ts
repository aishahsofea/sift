// The model sometimes imitates a training-time citation format and writes 【cite_page】
// into its answer. It is not a tool call and verifies nothing, so it only shows the
// user a meaningless marker (#48). Quotes are verified through the tool, never here.
export function stripCitationMarkers(text: string): string {
  return text
    .replace(/[ \t]*【[^】\n]*】/g, '')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
}
