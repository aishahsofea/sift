// Wording for a page Sift only partly read (#12). The count is in characters
// because that is what the model was told, so the panel and the prompt agree.
function characters(count: number): string {
  return `${count.toLocaleString('en-US')} characters`
}

// Above the thread, before the first question.
export function describeTruncatedPage(charsOmitted: number): string {
  return `The last ${characters(charsOmitted)} of this page weren't read, so answers about that part can't come from the page.`
}

// On each answer given against such a page.
export function describeTruncatedAnswer(charsOmitted: number): string {
  return `Page was cut off: ${characters(charsOmitted)} weren't read.`
}
