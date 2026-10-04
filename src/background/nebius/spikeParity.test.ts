import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ExtractedPage } from '../../shared/types'
import { assembleAgentMessages } from './promptAssembly'
import {
  CITE_DONE_NOTE,
  CITE_NUDGE,
  CITE_NUDGE_CUT,
  CITE_PARTIAL_NOTE,
  CITE_RECOVERY_HINT,
  CITE_TOOL,
  CITE_TOOL_CUT,
  FETCH_NOTE,
  FETCH_NOTE_CUT,
  FORCE_NUDGE,
  FORCE_NUDGE_CITE,
  FORCE_RETRY,
  PAGE_SEARCH_EMPTY_NOTE,
  PAGE_SEARCH_EMPTY_NOTE_FETCHED,
  PAGE_SEARCH_NOTE,
  PAGE_SEARCH_NOTE_FETCHED,
  SEARCH_NOTE,
  SEARCH_PAGE_TOOL,
} from './tools'

// The standalone script keeps its own copy of the prompt and tool wording and is the only live check of it (ADR 0001, 0003, 0005, 0006); this fails when the two drift.
const script = readFileSync(new URL('../../../scripts/test-nebius-tools.mjs', import.meta.url), 'utf8')

const page: ExtractedPage = {
  url: 'https://loomkit.example/blog/introducing-loomkit-2',
  title: 'Introducing Loomkit 2.0',
  content: 'The launch date is March 3rd.',
  extractionMethod: 'readability',
  truncated: false,
  charsOmitted: 0,
}
const truncatedPage: ExtractedPage = { ...page, truncated: true, charsOmitted: 126_323 }

type SpikePage = Pick<ExtractedPage, 'url' | 'title' | 'content'> & { truncated?: boolean; charsOmitted?: number }

// The script's own function lifted from its source, so this runs what the spike sends.
function spikeSystemPrompt(): (page: SpikePage, options: { search: boolean; cite: boolean; pageSearch?: boolean }) => string {
  const source = script.match(/function systemPrompt\([^)]*\) \{[\s\S]*?\n\}\n/)?.[0]
  if (!source) throw new Error('systemPrompt() not found in scripts/test-nebius-tools.mjs')
  return (0, eval)(`(${source})`)
}

// FETCH_NOTE_CUT lifted the same way; a function, so both sides are called with the same input.
function spikeFetchNoteCut(): (charsOmitted: number) => string {
  const source = script.match(/function FETCH_NOTE_CUT\([^)]*\) \{[\s\S]*?\n\}\n/)?.[0]
  if (!source) throw new Error('FETCH_NOTE_CUT not found in scripts/test-nebius-tools.mjs')
  return (0, eval)(`(${source})`)
}

// Tool definitions evaluated in one scope, since the cut cite_page spreads the whole-page one.
function spikeTools(): { SEARCH_PAGE_TOOL: unknown; CITE_TOOL: unknown; CITE_TOOL_CUT: unknown } {
  const declaration = (name: string) => {
    const source = script.match(new RegExp(`const ${name} = [\\s\\S]*?\\n\\};\\n`))?.[0]
    if (!source) throw new Error(`${name} not found in scripts/test-nebius-tools.mjs`)
    return source
  }
  const names = ['CITE_TOOL', 'SEARCH_PAGE_TOOL', 'CITE_TOOL_CUT']
  return (0, eval)(`(() => { ${names.map(declaration).join('\n')}; return { ${names.join(', ')} } })()`)
}

describe('scripts/test-nebius-tools.mjs parity', () => {
  const wholePage = [
    { search: true, cite: true },
    { search: true, cite: false },
    { search: false, cite: true },
    { search: false, cite: false },
  ]

  it.each(wholePage)('sends the system prompt production sends (search: $search, cite: $cite)', ({ search, cite }) => {
    const [system] = assembleAgentMessages(page, [], 'q', { searchEnabled: search, citeEnabled: cite, pageSearchEnabled: false })
    expect(spikeSystemPrompt()(page, { search, cite })).toBe(system.content)
  })

  // A page cut short whose rest was not kept: what every long page got before #11.
  it.each([{ search: true }, { search: false }])(
    'sends the cut-page prompt production sends when the rest was not kept (search: $search)',
    ({ search }) => {
      const [system] = assembleAgentMessages(truncatedPage, [], 'q', { searchEnabled: search, citeEnabled: false, pageSearchEnabled: false })
      expect(spikeSystemPrompt()(truncatedPage, { search, cite: false })).toBe(system.content)
    },
  )

  // A page cut short whose rest was kept, so search_page is offered (ADR 0006).
  it.each([{ search: true }, { search: false }])(
    'sends the cut-page prompt production sends when its rest can be searched (search: $search)',
    ({ search }) => {
      const [system] = assembleAgentMessages(truncatedPage, [], 'q', { searchEnabled: search, citeEnabled: true, pageSearchEnabled: true })
      expect(spikeSystemPrompt()(truncatedPage, { search, cite: true, pageSearch: true })).toBe(system.content)
    },
  )

  it('checks the cite_page tool wording it ships', () => {
    expect(script).toContain(CITE_TOOL.function.description)
    expect(script).toContain(CITE_TOOL.function.parameters.properties.quotes.description)
  })

  it('offers the tools production offers, whole: cite_page, search_page, and cite_page as offered beside it', () => {
    const tools = spikeTools()
    expect(tools.CITE_TOOL).toEqual(CITE_TOOL)
    expect(tools.SEARCH_PAGE_TOOL).toEqual(SEARCH_PAGE_TOOL)
    expect(tools.CITE_TOOL_CUT).toEqual(CITE_TOOL_CUT)
  })

  it('checks the notes it puts in search, fetch and cite_page results', () => {
    for (const text of [SEARCH_NOTE, FETCH_NOTE, CITE_DONE_NOTE, CITE_PARTIAL_NOTE, CITE_RECOVERY_HINT]) {
      expect(script).toContain(text)
    }
  })

  it('checks the note it puts in a search_page result, found or not', () => {
    for (const text of [PAGE_SEARCH_NOTE, PAGE_SEARCH_EMPTY_NOTE, PAGE_SEARCH_NOTE_FETCHED, PAGE_SEARCH_EMPTY_NOTE_FETCHED]) {
      expect(script).toContain(text)
    }
  })

  it('checks the note it puts in a fetch_page result that came back cut (#7)', () => {
    expect(spikeFetchNoteCut()(12_345)).toBe(FETCH_NOTE_CUT(12_345))
  })

  it('checks the nudge that asks for quotes after an uncited answer, on a whole page and on a cut one', () => {
    expect(script).toContain(CITE_NUDGE)
    expect(script).toContain(CITE_NUDGE_CUT)
  })

  it('checks the nudges that end the loop, with and without cite_page on offer', () => {
    for (const text of [FORCE_NUDGE, FORCE_NUDGE_CITE, FORCE_RETRY]) {
      expect(script).toContain(text)
    }
  })
})
