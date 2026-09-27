const MAX_TITLE_LENGTH = 80

const TITLE_VARIANTS: Array<(title: string) => string> = [
  (title) => `What do you want to know about “${title}”?`,
  (title) => `Ask me anything about “${title}”.`,
  (title) => `What would you like to find out from “${title}”?`,
  (title) => `Got a question about “${title}”?`,
  (title) => `Where should we start with “${title}”?`,
  (title) => `Something in “${title}” you'd like unpacked?`,
]

const TITLELESS_VARIANTS = [
  'What do you want to know about this page?',
  'Ask me anything about this page.',
  "Got a question about what you're reading?",
]

// Collapses run-on whitespace and caps length so the greeting stays to a line or two
// even when a page's <title> is a whole sentence. Blank (or absent) becomes undefined
// so pickGreeting falls back to the title-less pool instead of greeting "" (#16).
export function formatPageTitle(title: string | undefined): string | undefined {
  const collapsed = title?.replace(/\s+/g, ' ').trim()
  if (!collapsed) return undefined
  return collapsed.length > MAX_TITLE_LENGTH ? `${collapsed.slice(0, MAX_TITLE_LENGTH).trimEnd()}…` : collapsed
}

// One variant for an empty chat (#16). `random` is injected so the pick is
// deterministic in tests; `exclude` is the greeting shown last time this tab's chat
// was empty, kept out of the draw so it's never repeated back to back.
export function pickGreeting(title: string | undefined, random: () => number, exclude?: string): string {
  const formattedTitle = formatPageTitle(title)
  const pool = formattedTitle ? TITLE_VARIANTS.map((variant) => variant(formattedTitle)) : TITLELESS_VARIANTS
  const choices = pool.length > 1 ? pool.filter((greeting) => greeting !== exclude) : pool
  return choices[Math.floor(random() * choices.length)]
}
