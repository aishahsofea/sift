import type { AgentStep } from '../shared/types'

// Shown while a tool round runs; the query is the model's own wording, which turns a follow-up into a searchable phrase.
export function describeStep(step: AgentStep): string {
  switch (step.kind) {
    case 'searching':
      return `Searching ${step.domain} for “${step.query}”…`
    case 'reading':
      return `Reading ${shortenUrl(step.url)}…`
    case 'scanning':
      return `Searching this page for “${step.query}”…`
    case 'citing':
      return 'Checking quotes against the page…'
  }
}

function shortenUrl(url: string): string {
  try {
    const { hostname, pathname } = new URL(url)
    return `${hostname}${pathname === '/' ? '' : pathname}`.replace(/\/$/, '')
  } catch {
    return url
  }
}
