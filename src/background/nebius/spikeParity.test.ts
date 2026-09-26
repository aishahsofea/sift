import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ExtractedPage } from '../../shared/types'
import { assembleAgentMessages } from './promptAssembly'
import {
  CITE_DONE_NOTE,
  CITE_NUDGE,
  CITE_PARTIAL_NOTE,
  CITE_RECOVERY_HINT,
  CITE_TOOL,
  FETCH_NOTE,
  FORCE_NUDGE,
  FORCE_NUDGE_CITE,
  FORCE_RETRY,
  SEARCH_NOTE,
} from './tools'

// scripts/test-nebius-tools.mjs is standalone, so it keeps its own copy of the
// prompt and tool wording, and it is the only thing that checks that wording against
// the real model (ADR 0001, ADR 0003, ADR 0005). A prompt edit that never reaches it
// is verified prompt surface that is no longer verified. This fails when the two drift.
const script = readFileSync(new URL('../../../scripts/test-nebius-tools.mjs', import.meta.url), 'utf8')

const page: ExtractedPage = {
  url: 'https://loomkit.example/blog/introducing-loomkit-2',
  title: 'Introducing Loomkit 2.0',
  content: 'The launch date is March 3rd.',
  extractionMethod: 'readability',
  truncated: false,
  charsOmitted: 0,
}

// The script's own function, lifted out of its source so what runs here is what
// the live spike sends.
function spikeSystemPrompt(): (page: { title: string; url: string; content: string }, options: { search: boolean; cite: boolean }) => string {
  const source = script.match(/function systemPrompt\(page, \{ search, cite \}\) \{[\s\S]*?\n\}\n/)?.[0]
  if (!source) throw new Error('systemPrompt() not found in scripts/test-nebius-tools.mjs')
  return (0, eval)(`(${source})`)
}

describe('scripts/test-nebius-tools.mjs parity', () => {
  const combinations = [
    { search: true, cite: true },
    { search: true, cite: false },
    { search: false, cite: true },
    { search: false, cite: false },
  ]

  it.each(combinations)('sends the system prompt production sends (search: $search, cite: $cite)', ({ search, cite }) => {
    const [system] = assembleAgentMessages(page, [], 'q', { searchEnabled: search, citeEnabled: cite })
    expect(spikeSystemPrompt()(page, { search, cite })).toBe(system.content)
  })

  it('checks the cite_page tool wording it ships', () => {
    expect(script).toContain(CITE_TOOL.function.description)
    expect(script).toContain(CITE_TOOL.function.parameters.properties.quotes.description)
  })

  it('checks the notes it puts in search, fetch and cite_page results', () => {
    for (const text of [SEARCH_NOTE, FETCH_NOTE, CITE_DONE_NOTE, CITE_PARTIAL_NOTE, CITE_RECOVERY_HINT]) {
      expect(script).toContain(text)
    }
  })

  it('checks the nudge that asks for quotes after an uncited answer', () => {
    expect(script).toContain(CITE_NUDGE)
  })

  it('checks the nudges that end the loop, with and without cite_page on offer', () => {
    for (const text of [FORCE_NUDGE, FORCE_NUDGE_CITE, FORCE_RETRY]) {
      expect(script).toContain(text)
    }
  })
})
