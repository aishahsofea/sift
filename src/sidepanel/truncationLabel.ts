// Wording for a partly read page (#12); counts are in characters, as the model was told.
function characters(count: number): string {
  return `${count.toLocaleString('en-US')} characters`
}

// Banner above the thread: says the rest is searchable when kept (#11), otherwise that it wasn't read.
export function describeTruncatedPage(charsOmitted: number, searchable: boolean): string {
  return searchable
    ? `Sift reads the start up front and searches the remaining ${characters(charsOmitted)} when a question needs them.`
    : `The last ${characters(charsOmitted)} of this page weren't read, so answers about that part can't come from the page.`
}

// On an answer where the model never looked past the cut: it didn't search, or nothing was searchable.
export function describeTruncatedAnswer(charsOmitted: number): string {
  return `Page was cut off: ${characters(charsOmitted)} weren't read.`
}
