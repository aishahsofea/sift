// Wording for a page Sift only partly read (#12). The count is in characters
// because that is what the model was told, so the panel and the prompt agree.
function characters(count: number): string {
  return `${count.toLocaleString('en-US')} characters`
}

// Above the thread, before the first question. Where the rest of the page was kept the
// model can search it (#11), so the banner says that rather than that it wasn't read;
// where it wasn't kept, it says what it always did.
export function describeTruncatedPage(charsOmitted: number, searchable: boolean): string {
  return searchable
    ? `Sift reads the start up front and searches the remaining ${characters(charsOmitted)} when a question needs them.`
    : `The last ${characters(charsOmitted)} of this page weren't read, so answers about that part can't come from the page.`
}

// On an answer given against such a page without the model looking past the cut: either
// it never searched the rest, or there was nothing to search.
export function describeTruncatedAnswer(charsOmitted: number): string {
  return `Page was cut off: ${characters(charsOmitted)} weren't read.`
}
