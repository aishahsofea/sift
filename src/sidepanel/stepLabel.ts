import type { AgentStep } from '../shared/types'

// Shown while a tool round runs; the query is the model's own wording, which makes a follow-up searchable.
export function describeStep(step: AgentStep): string {
  return `${stepText(step)}…`
}

// Wording for the list kept with a finished answer; a quote check also says how many quotes were found.
export function describeStepDone(step: AgentStep): string {
  const text = stepText(step)
  return step.kind === 'citing' && step.total !== undefined ? `${text}: ${step.found ?? 0} of ${step.total} found` : text
}

function stepText(step: AgentStep): string {
  switch (step.kind) {
    case 'searching':
      return `Searching ${step.domain} for “${step.query}”`
    case 'reading':
      return `Reading ${shortenUrl(step.url)}`
    case 'scanning':
      return `Searching this page for “${step.query}”`
    case 'citing':
      return 'Checking quotes against the page'
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
