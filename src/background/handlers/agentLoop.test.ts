import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FETCHED_PAGE_CHAR_LIMIT, MAX_TOOL_ROUNDS, PAGE_SEARCH_FETCH_PASSAGES, PAGE_SEARCH_MAX_PASSAGES, PAGE_SEARCH_PASSAGE_CHARS } from '../../shared/constants'
import type { AskPortMessage } from '../../shared/messages'
import type { ChatTurn, ExtractedPage } from '../../shared/types'
import { appendTrace } from '../history/agentTraces'
import { appendHistoryTurns, getExtractedPage, getFullPageContent, getHistory } from '../history/sessionHistory'
import { getApiKeys, getTraceContentEnabled } from '../keys'
import { streamAgentTurn, type AgentTurn } from '../nebius/client'
import type { ChatMessage } from '../nebius/promptAssembly'
import {
  CITE_DONE_NOTE,
  CITE_NUDGE,
  CITE_NUDGE_CUT,
  CITE_PARTIAL_NOTE,
  FETCH_NOTE,
  FETCH_NOTE_CUT,
  FORCE_NUDGE,
  FORCE_NUDGE_CITE,
  FORCE_RETRY,
  PAGE_SEARCH_EMPTY_NOTE,
  PAGE_SEARCH_NOTE,
  PAGE_SEARCH_NOTE_FETCHED,
  SEARCH_NOTE,
} from '../nebius/tools'
import { extractTavily, searchTavily } from '../tavily/client'
import { runAgentLoop } from './agentLoop'

// Driven through runAgentLoop with only the model, Tavily, chrome.storage and the port faked.
vi.mock('../history/sessionHistory', () => ({
  getExtractedPage: vi.fn(),
  getFullPageContent: vi.fn(),
  getHistory: vi.fn(),
  appendHistoryTurns: vi.fn(),
}))
vi.mock('../history/agentTraces', () => ({ getTraces: vi.fn(), appendTrace: vi.fn() }))
vi.mock('../keys', () => ({ getApiKeys: vi.fn(), getTraceContentEnabled: vi.fn() }))
vi.mock('../nebius/client', () => ({ streamAgentTurn: vi.fn() }))
vi.mock('../tavily/client', () => ({ searchTavily: vi.fn(), extractTavily: vi.fn() }))

const QUOTE = 'Thanks to the 1,200 beta testers who filed over 3,000 bug reports'

const wholePage: ExtractedPage = {
  url: 'https://loomkit.example/blog/introducing-loomkit-2',
  title: 'Introducing Loomkit 2.0',
  content: `By Dana Reyes, co-founder.\n\n${QUOTE} during the preview.`,
  extractionMethod: 'readability',
  truncated: false,
  charsOmitted: 0,
}

// Cut short with the rest not kept: pages handled as before #11, or when the whole is too big.
const truncatedPage: ExtractedPage = { ...wholePage, truncated: true, charsOmitted: 126_323 }

// Cut short with the rest kept (#11): the answering section is past `wholePage.content`.
const TAIL_QUOTE = 'The jailbreak works by starting the dangerous answer before the model can refuse it'
const tail = `\n\nLife of a Jailbreak\n\n${TAIL_QUOTE}, after which the model keeps going.`
const fullContent = wholePage.content + tail
const cutPage: ExtractedPage = { ...wholePage, truncated: true, charsOmitted: tail.length, searchable: true }

let callId = 0
const toolRound = (name: string, args: unknown): AgentTurn => ({
  content: '',
  toolCalls: [{ id: `call_${++callId}`, name, argsText: JSON.stringify(args) }],
})
const cite = (...quotes: string[]) => toolRound('cite_page', { quotes })
const search = (query: string) => toolRound('search_site', { query })
const scan = (query: string) => toolRound('search_page', { query })
const answer = (content: string): AgentTurn => ({ content, toolCalls: [] })

// Snapshotted per model call, since the loop keeps appending to the same messages array.
let modelCalls: { messages: ChatMessage[]; tools: unknown }[]

function scriptModel(...rounds: AgentTurn[]): void {
  const queue = [...rounds]
  vi.mocked(streamAgentTurn).mockImplementation(async (_key, messages, { tools, onContent }) => {
    modelCalls.push({ messages: structuredClone(messages), tools })
    const next = queue.shift()
    if (!next) throw new Error('The loop called the model more times than the test scripted.')
    if (next.content) onContent(next.content)
    return next
  })
}

async function ask(question = 'How many beta testers were there?') {
  const posted: AskPortMessage[] = []
  const port = {
    postMessage: (message: AskPortMessage) => posted.push(message),
    onDisconnect: { addListener: () => {} },
  } as unknown as chrome.runtime.Port

  await runAgentLoop(port, 1, question)

  const done = posted.find((m): m is Extract<AskPortMessage, { type: 'ASK_DONE' }> => m.type === 'ASK_DONE')
  const failed = posted.find((m): m is Extract<AskPortMessage, { type: 'ASK_ERROR' }> => m.type === 'ASK_ERROR')
  return { posted, turn: done?.turn as ChatTurn, error: failed?.message }
}

// The tool-role messages the model was sent on a given call, parsed.
function toolResults(callIndex: number): Record<string, unknown>[] {
  return modelCalls[callIndex].messages
    .filter((m): m is Extract<ChatMessage, { role: 'tool' }> => m.role === 'tool')
    .map((m) => JSON.parse(m.content))
}

const toolNames = (tools: unknown): string[] =>
  Array.isArray(tools) ? tools.map((t: { function: { name: string } }) => t.function.name) : []

// What the loop wrote to the service worker console, as one string.
const logged = () => vi.mocked(console.log).mock.calls.map((args) => args.join(' ')).join('\n')

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  callId = 0
  modelCalls = []
  vi.mocked(getApiKeys).mockResolvedValue({ nebiusApiKey: 'nebius-key', tavilyApiKey: 'tavily-key' })
  vi.mocked(getTraceContentEnabled).mockResolvedValue(false)
  vi.mocked(getExtractedPage).mockResolvedValue(wholePage)
  vi.mocked(getFullPageContent).mockResolvedValue(undefined)
  vi.mocked(getHistory).mockResolvedValue([])
  vi.mocked(appendHistoryTurns).mockResolvedValue([])
  vi.mocked(appendTrace).mockResolvedValue(undefined)
})

describe('quote-then-answer (ADR 0005)', () => {
  it('labels an answer from the page when a quote it cited is found in the page, and keeps the quote', async () => {
    scriptModel(cite(QUOTE), answer('There were 1,200 beta testers.'))

    const { turn, error } = await ask()

    expect(error).toBeUndefined()
    expect(turn).toMatchObject({ role: 'assistant', source: 'page', quotes: [QUOTE] })
    expect(vi.mocked(appendHistoryTurns)).toHaveBeenCalledWith(1, [
      { role: 'user', content: 'How many beta testers were there?' },
      turn,
    ])
  })

  it('tells the model which quotes were verified', async () => {
    scriptModel(cite(QUOTE), answer('1,200.'))

    await ask()

    expect(toolResults(1)).toEqual([{ verified: [QUOTE], note: CITE_DONE_NOTE }])
  })

  it('does not label an answer from the page when the model never cited it, even after being asked to', async () => {
    scriptModel(answer('There were about 500 beta testers.'), answer('There were about 500 beta testers.'))

    const { turn } = await ask()

    expect(turn.source).toBe('unverified')
    expect(turn).not.toHaveProperty('quotes')
  })

  it('answers a fabricated quote with a tool-role error and a corrected round, not a thrown loop', async () => {
    scriptModel(
      cite('The attack works by asking the model to think step by step'),
      cite(QUOTE),
      answer('There were 1,200 beta testers.'),
    )

    const { turn, error } = await ask()

    expect(error).toBeUndefined()
    const [rejection] = toolResults(1)
    expect(rejection.verified).toEqual([])
    expect(rejection.error).toContain('quote not found in page text')
    // Nothing verified yet, so the way out is to try again, not to answer.
    expect(rejection).not.toHaveProperty('note')
    expect(turn).toMatchObject({ source: 'page', quotes: [QUOTE] })
  })

  it('does not label an answer from the page when every quote it cited was fabricated', async () => {
    scriptModel(cite('The attack works by asking the model to think step by step'), answer('It asks for step by step.'))

    const { turn } = await ask()

    expect(turn.source).toBe('unverified')
    expect(turn).not.toHaveProperty('quotes')
  })

  it('keeps the verified quote when the same call also held a fabricated one', async () => {
    scriptModel(cite(QUOTE, 'Loomkit 2.0 adds an AI assistant'), answer('1,200 testers.'))

    const { turn } = await ask()

    expect(turn).toMatchObject({ source: 'page', quotes: [QUOTE] })
    expect(toolResults(1)[0].error).toContain('Loomkit 2.0 adds an AI assistant')
  })

  it('stops the model citing once one quote has verified: it answers with what verified, rejected or not', async () => {
    scriptModel(cite(QUOTE, 'Loomkit 2.0 adds an AI assistant'), answer('1,200 testers.'))

    await ask()

    expect(toolResults(1)[0]).toMatchObject({ verified: [QUOTE], note: CITE_PARTIAL_NOTE })
    expect(toolResults(1)[0]).not.toMatchObject({ note: CITE_DONE_NOTE })
  })

  it('lets a quote from the byline or the title verify, since the model reads both as the page', async () => {
    vi.mocked(getExtractedPage).mockResolvedValue({ ...wholePage, byline: 'AUTHORS\nJack Lindsey†\n† Lead Contributor' })
    scriptModel(cite('AUTHORS Jack Lindsey† † Lead Contributor'), answer('Jack Lindsey.'))

    const { turn } = await ask('Who is the lead contributor?')

    expect(turn.source).toBe('page')
  })

  it('rejects a quote too short to tie the answer to anything', async () => {
    scriptModel(cite('the'), answer('There were some.'))

    const { turn } = await ask()

    expect(toolResults(1)[0].error).toContain('quote too short')
    expect(turn.source).toBe('unverified')
  })

  it('turns a malformed cite_page call into a tool-role error the model can correct', async () => {
    scriptModel(toolRound('cite_page', { quotes: QUOTE }), cite(QUOTE), answer('1,200.'))

    const { turn, error } = await ask()

    expect(error).toBeUndefined()
    expect(toolResults(1)[0].error).toContain('"quotes" must be a non-empty list of strings')
    expect(turn.source).toBe('page')
  })

  it('tells the panel the quotes are being checked, before the check runs', async () => {
    scriptModel(cite(QUOTE), answer('1,200.'))

    const { posted } = await ask()

    const stepAt = posted.findIndex((m) => m.type === 'ASK_STEP' && m.step.kind === 'citing')
    const doneAt = posted.findIndex((m) => m.type === 'ASK_DONE')
    expect(stepAt).toBeGreaterThanOrEqual(0)
    expect(stepAt).toBeLessThan(doneAt)
  })

  it('ends on a forced answer, labelled unverified, when every round was spent on rejected quotes', async () => {
    const fake = 'Nothing on the page says anything like this'
    scriptModel(...Array.from({ length: MAX_TOOL_ROUNDS }, () => cite(fake)), answer("The page doesn't say."))

    const { turn, error } = await ask()

    expect(error).toBeUndefined()
    expect(turn.source).toBe('unverified')
    const forced = modelCalls[MAX_TOOL_ROUNDS]
    expect(forced.tools).toBeUndefined()
    expect(forced.messages.at(-1)).toEqual({ role: 'user', content: FORCE_NUDGE_CITE })
  })
})

// A tool-less page answer has nothing to verify (#5): discard it and ask the model to quote first (ADR 0005).
describe('an answer with no cite_page call on a whole page', () => {
  const chunks = (posted: AskPortMessage[]) =>
    posted.filter((m): m is Extract<AskPortMessage, { type: 'ASK_CHUNK' }> => m.type === 'ASK_CHUNK').map((m) => m.delta)

  it('is discarded, and the model is asked to quote before it answers again', async () => {
    scriptModel(answer('About 500 beta testers.'), cite(QUOTE), answer('There were 1,200 beta testers.'))

    const { turn, error } = await ask()

    expect(error).toBeUndefined()
    expect(modelCalls).toHaveLength(3)
    expect(modelCalls[1].messages.at(-1)).toEqual({ role: 'user', content: CITE_NUDGE })
    expect(turn).toMatchObject({ content: 'There were 1,200 beta testers.', source: 'page', quotes: [QUOTE] })
  })

  it('is never shown to the user or written to history', async () => {
    scriptModel(answer('About 500 beta testers.'), cite(QUOTE), answer('There were 1,200 beta testers.'))

    const { posted } = await ask()

    expect(chunks(posted).join('')).toBe('There were 1,200 beta testers.')
    expect(vi.mocked(appendHistoryTurns).mock.calls[0][1].map((t) => t.content)).not.toContain('About 500 beta testers.')
  })

  it('leaves the nudge out of the messages once the model has cited, so the conversation reads as if it had cited first', async () => {
    scriptModel(answer('About 500.'), cite(QUOTE), answer('1,200.'))

    await ask()

    expect(modelCalls[2].messages.some((m) => m.role === 'user' && m.content === CITE_NUDGE)).toBe(false)
    expect(modelCalls[2].messages.at(-1)).toMatchObject({ role: 'tool' })
  })

  it('tells the panel the quotes are being checked while it asks again', async () => {
    scriptModel(answer('About 500.'), cite(QUOTE), answer('1,200.'))

    const { posted } = await ask()

    const firstStep = posted.findIndex((m) => m.type === 'ASK_STEP' && m.step.kind === 'citing')
    const firstChunk = posted.findIndex((m) => m.type === 'ASK_CHUNK')
    expect(firstStep).toBeGreaterThanOrEqual(0)
    expect(firstStep).toBeLessThan(firstChunk)
  })

  it('asks once, and accepts a second uncited answer as unverified rather than asking forever', async () => {
    scriptModel(answer('About 500.'), answer('The page does not say.'))

    const { turn, posted } = await ask()

    expect(modelCalls).toHaveLength(2)
    expect(turn).toMatchObject({ content: 'The page does not say.', source: 'unverified' })
    expect(turn).not.toHaveProperty('quotes')
    // Nothing left to discard, so this one streams as it is written.
    expect(chunks(posted).join('')).toBe('The page does not say.')
  })

  it('is not asked again when the model searched first, even if the search found nothing', async () => {
    vi.mocked(searchTavily).mockResolvedValue([])
    scriptModel(search('Loomkit Pro price'), answer("I couldn't find it."))

    const { turn } = await ask('How much is Pro?')

    expect(modelCalls).toHaveLength(2)
    expect(turn.source).toBe('unverified')
  })

  it('is left alone on a cut page whose rest was not kept, where cite_page is not offered', async () => {
    vi.mocked(getExtractedPage).mockResolvedValue(truncatedPage)
    scriptModel(answer('About 500.'))

    const { turn } = await ask()

    expect(modelCalls).toHaveLength(1)
    expect(turn.content).toBe('About 500.')
  })

  it('lets the model search instead of citing when asked, without asking again', async () => {
    vi.mocked(searchTavily).mockResolvedValue([{ title: 'Pricing', url: 'https://loomkit.example/pricing', content: 'Pro: $17.50.' }])
    scriptModel(answer('It is free.'), search('Loomkit Pro price'), answer('$17.50.'))

    const { turn, error } = await ask('How much is Pro?')

    expect(error).toBeUndefined()
    expect(modelCalls).toHaveLength(3)
    expect(turn).toMatchObject({ content: '$17.50.', source: 'web' })
  })

  it('does not use up one of the tool rounds', async () => {
    vi.mocked(searchTavily).mockResolvedValue([])
    const searches = Array.from({ length: MAX_TOOL_ROUNDS }, (_, i) => search(`query ${i}`))
    scriptModel(answer('About 500.'), ...searches, answer("I couldn't find it."))

    const { turn, error } = await ask()

    expect(error).toBeUndefined()
    // The discarded answer, every search the cap allows, then the forced answer.
    expect(modelCalls).toHaveLength(MAX_TOOL_ROUNDS + 2)
    expect(modelCalls.at(-1)?.tools).toBeUndefined()
    expect(modelCalls.at(-1)?.messages.at(-1)).toEqual({ role: 'user', content: FORCE_NUDGE_CITE })
    expect(turn.content).toBe("I couldn't find it.")
  })

  it('is logged, so a discarded answer is not invisible', async () => {
    scriptModel(answer('About 500.'), cite(QUOTE), answer('1,200.'))

    await ask()

    expect(logged()).toContain('asked to quote first')
  })
})

// The model reached for cite_page in the tool-less last round, which used to be a user-facing error.
describe('the forced final round', () => {
  const spent = () => Array.from({ length: MAX_TOOL_ROUNDS }, (_, i) => search(`query ${i}`))

  beforeEach(() => {
    vi.mocked(searchTavily).mockResolvedValue([])
  })

  it('tells the model on a whole page that cite_page is gone too, not only search', async () => {
    scriptModel(...spent(), answer("I couldn't find it."))

    await ask()

    expect(modelCalls.at(-1)?.messages.at(-1)).toEqual({ role: 'user', content: FORCE_NUDGE_CITE })
  })

  it('keeps the search-only nudge where cite_page was never offered (a cut page whose rest was not kept)', async () => {
    vi.mocked(getExtractedPage).mockResolvedValue(truncatedPage)
    scriptModel(...spent(), answer("I couldn't find it."))

    await ask()

    expect(modelCalls.at(-1)?.messages.at(-1)).toEqual({ role: 'user', content: FORCE_NUDGE })
  })

  it('asks once more, instead of failing, when the model still calls a tool', async () => {
    scriptModel(...spent(), cite(QUOTE), answer('There were 1,200 beta testers.'))

    const { turn, error } = await ask()

    expect(error).toBeUndefined()
    expect(turn.content).toBe('There were 1,200 beta testers.')
    const retry = modelCalls.at(-1)
    expect(retry?.tools).toBeUndefined()
    expect(retry?.messages.slice(-2)).toEqual([
      { role: 'user', content: FORCE_NUDGE_CITE },
      { role: 'user', content: FORCE_RETRY },
    ])
  })

  it('does not credit the cite_page call it refused to run', async () => {
    scriptModel(...spent(), cite(QUOTE), answer('There were 1,200 beta testers.'))

    const { turn } = await ask()

    expect(turn.source).toBe('unverified')
    expect(turn).not.toHaveProperty('quotes')
  })

  it('fails, as before, if it still calls a tool after being asked twice', async () => {
    scriptModel(...spent(), cite(QUOTE), cite(QUOTE))

    const { turn, error } = await ask()

    expect(turn).toBeUndefined()
    expect(error).toBe('The model kept searching instead of answering.')
  })
})

describe('with a web result', () => {
  const results = [{ title: 'Pricing', url: 'https://loomkit.example/pricing', content: 'Pro: $17.50.' }]

  beforeEach(() => {
    vi.mocked(searchTavily).mockResolvedValue(results)
  })

  it('labels an answer from the web when nothing on the page was quoted', async () => {
    scriptModel(search('Loomkit Pro price'), answer('$17.50.'))

    const { turn } = await ask('How much is Pro?')

    expect(turn.source).toBe('web')
    expect(turn).not.toHaveProperty('quotes')
  })

  it('says in the search result that it is not the page, so the model does not cite the snippet', async () => {
    scriptModel(search('Loomkit Pro price'), answer('$17.50.'))

    await ask('How much is Pro?')

    expect(toolResults(1)).toEqual([{ results, note: SEARCH_NOTE }])
  })

  it('says the same of a fetched page', async () => {
    vi.mocked(extractTavily).mockResolvedValue('Pro: $17.50 per user per month.')
    scriptModel(search('Loomkit Pro price'), toolRound('fetch_page', { url: results[0].url }), answer('$17.50.'))

    await ask('How much is Pro?')

    expect(toolResults(2)[1]).toEqual({
      url: results[0].url,
      content: 'Pro: $17.50 per user per month.',
      note: FETCH_NOTE,
    })
    // Nothing was cut, so search_page stays off the table (#7).
    expect(toolNames(modelCalls[2].tools)).not.toContain('search_page')
  })

  it('adds no note when cite_page is not offered, since there is nothing to warn off', async () => {
    vi.mocked(getExtractedPage).mockResolvedValue(truncatedPage)
    scriptModel(search('Loomkit Pro price'), answer('$17.50.'))

    await ask('How much is Pro?')

    expect(toolResults(1)).toEqual([{ results }])
  })

  it('labels an answer page+web when a page quote was verified next to the web result', async () => {
    scriptModel(search('Loomkit Pro price'), cite(QUOTE), answer('1,200 testers; Pro is $17.50.'))

    const { turn } = await ask('How many testers, and how much is Pro?')

    expect(turn).toMatchObject({ source: 'page+web', quotes: [QUOTE] })
  })
})

// A fetch_page result can come back cut (#7); search_page reaches its rest and beats a cut tab page.
describe('a fetched page that comes back cut (#7)', () => {
  const results = [{ title: 'Board pruning', url: 'https://loomkit.example/help/board-pruning', content: 'An overview of board pruning.' }]
  // Longer than FETCHED_PAGE_CHAR_LIMIT, with the answer past the cut.
  const FETCH_TAIL_QUOTE = 'the cumulative influence score falls below a threshold of 0.42'
  const fetchedFullContent = 'lorem ipsum dolor sit amet '.repeat(Math.ceil(FETCHED_PAGE_CHAR_LIMIT / 27) + 50) + FETCH_TAIL_QUOTE
  const charsOmitted = fetchedFullContent.length - FETCHED_PAGE_CHAR_LIMIT

  beforeEach(() => {
    vi.mocked(searchTavily).mockResolvedValue(results)
    vi.mocked(extractTavily).mockResolvedValue(fetchedFullContent)
  })

  it('cuts the fetch at FETCHED_PAGE_CHAR_LIMIT and tells the model search_page can reach the rest', async () => {
    scriptModel(search('board pruning'), toolRound('fetch_page', { url: results[0].url }), scan('threshold'), answer('The threshold is 0.42.'))

    const { turn, error } = await ask('How does board pruning decide what to remove?')

    expect(error).toBeUndefined()
    const [, fetchResult] = toolResults(3)
    expect(fetchResult.content).toHaveLength(FETCHED_PAGE_CHAR_LIMIT)
    expect(fetchResult.note).toBe(FETCH_NOTE_CUT(charsOmitted))
    expect(turn).toMatchObject({ content: 'The threshold is 0.42.', source: 'web' })
  })

  it('offers search_page for the rest of the turn once the fetch comes back cut, even though the tab page is whole', async () => {
    scriptModel(search('board pruning'), toolRound('fetch_page', { url: results[0].url }), scan('threshold'), answer('The threshold is 0.42.'))

    await ask('How does board pruning decide what to remove?')

    expect(toolNames(modelCalls[0].tools)).not.toContain('search_page')
    expect(toolNames(modelCalls[2].tools)).toEqual(['search_site', 'fetch_page', 'cite_page', 'search_page'])
  })

  it('returns up to six passages for a cut fetch, all from past the cut', async () => {
    const head = 'threshold '.repeat(Math.ceil(FETCHED_PAGE_CHAR_LIMIT / 10) + 10)
    const sections = Array.from({ length: 8 }, (_, i) => `${'lorem ipsum dolor sit amet '.repeat(150)}threshold section ${i}`)
    vi.mocked(extractTavily).mockResolvedValue(head + sections.join(' '))
    scriptModel(search('board pruning'), toolRound('fetch_page', { url: results[0].url }), scan('threshold'), answer('The threshold is 0.42.'))

    await ask('How does board pruning decide what to remove?')

    const [, , searchPageResult] = toolResults(3)
    const passages = searchPageResult.passages as { offset: number; text: string }[]
    expect(passages).toHaveLength(PAGE_SEARCH_FETCH_PASSAGES)
    for (const { offset, text } of passages) expect(offset + text.length).toBeGreaterThan(FETCHED_PAGE_CHAR_LIMIT)
  })

  it('does not switch cite_page to the search_page-aware wording: cite_page still only checks the tab page', async () => {
    scriptModel(search('board pruning'), toolRound('fetch_page', { url: results[0].url }), scan('threshold'), answer('The threshold is 0.42.'))

    await ask('How does board pruning decide what to remove?')

    const cite = (modelCalls[2].tools as { function: { name: string; description: string } }[]).find((t) => t.function.name === 'cite_page')
    expect(cite?.function.description).not.toContain('came from search_page')
  })

  it("says the passages search_page found are from the fetched page, not the one being viewed, so cite_page can't check them", async () => {
    scriptModel(search('board pruning'), toolRound('fetch_page', { url: results[0].url }), scan('threshold'), answer('The threshold is 0.42.'))

    await ask('How does board pruning decide what to remove?')

    const [, , searchPageResult] = toolResults(3)
    expect(searchPageResult.note).toBe(PAGE_SEARCH_NOTE_FETCHED)
    const passages = searchPageResult.passages as { text: string }[]
    expect(passages.some((p) => p.text.includes(FETCH_TAIL_QUOTE))).toBe(true)
  })

  it('rejects a cite_page call quoting the fetched page, cut or not: cite_page is never offered a way to check it', async () => {
    scriptModel(search('board pruning'), toolRound('fetch_page', { url: results[0].url }), cite(FETCH_TAIL_QUOTE), answer('The threshold is 0.42.'))

    const { turn, error } = await ask('How does board pruning decide what to remove?')

    expect(error).toBeUndefined()
    expect(toolResults(3).at(-1)?.error).toContain('quote not found in page text')
    expect(turn.source).toBe('web')
  })

  it('adds the cut-fetch note even with no cite_page on offer at all: it is the instruction to reach the rest, not just a citing warning', async () => {
    vi.mocked(getExtractedPage).mockResolvedValue(truncatedPage)
    scriptModel(search('board pruning'), toolRound('fetch_page', { url: results[0].url }), scan('threshold'), answer('The threshold is 0.42.'))

    await ask('How does board pruning decide what to remove?')

    expect(toolNames(modelCalls[2].tools)).toEqual(['search_site', 'fetch_page', 'search_page'])
    const [, fetchResult] = toolResults(3)
    expect(fetchResult.note).toBe(FETCH_NOTE_CUT(charsOmitted))
  })

  it('searches the cut fetch, not the tab page, when both are cut in the same turn: the fetch is the most recent thing asked for', async () => {
    vi.mocked(getExtractedPage).mockResolvedValue(cutPage)
    vi.mocked(getFullPageContent).mockResolvedValue(fullContent)
    scriptModel(search('board pruning'), toolRound('fetch_page', { url: results[0].url }), scan('threshold'), answer('The threshold is 0.42.'))

    await ask('How does board pruning decide what to remove?')

    const [, , searchPageResult] = toolResults(3)
    const passages = searchPageResult.passages as { text: string }[]
    expect(passages.some((p) => p.text.includes(FETCH_TAIL_QUOTE))).toBe(true)
    expect(passages.some((p) => p.text.includes(TAIL_QUOTE))).toBe(false)
    expect(searchPageResult.note).toBe(PAGE_SEARCH_NOTE_FETCHED)
  })
})

describe('which tools a round is offered', () => {
  it('offers cite_page alongside the search tools on a whole page', async () => {
    scriptModel(answer('1,200.'))

    await ask()

    expect(toolNames(modelCalls[0].tools)).toEqual(['search_site', 'fetch_page', 'cite_page'])
    expect(modelCalls[0].messages[0].content).toContain('call cite_page')
  })

  it('still offers cite_page with no Tavily key, since it needs no network', async () => {
    vi.mocked(getApiKeys).mockResolvedValue({ nebiusApiKey: 'nebius-key', tavilyApiKey: undefined })
    scriptModel(cite(QUOTE), answer('1,200.'))

    const { turn } = await ask()

    expect(toolNames(modelCalls[0].tools)).toEqual(['cite_page'])
    expect(turn).toMatchObject({ source: 'page', quotes: [QUOTE] })
  })

  it('does not offer cite_page on a truncated page whose rest was not kept: the label is capped there anyway, so the round buys nothing', async () => {
    vi.mocked(getExtractedPage).mockResolvedValue(truncatedPage)
    scriptModel(answer('1,200.'))

    const { turn } = await ask()

    expect(toolNames(modelCalls[0].tools)).toEqual(['search_site', 'fetch_page'])
    expect(modelCalls[0].messages[0].content).not.toContain('cite_page')
    expect(turn.source).toBe('unverified')
    expect(turn).toMatchObject({ truncated: true, charsOmitted: 126_323 })
  })

  it('sends no tools at all on a truncated page whose rest was not kept, with no Tavily key', async () => {
    vi.mocked(getExtractedPage).mockResolvedValue(truncatedPage)
    vi.mocked(getApiKeys).mockResolvedValue({ nebiusApiKey: 'nebius-key', tavilyApiKey: undefined })
    scriptModel(answer('1,200.'))

    await ask()

    expect(modelCalls[0].tools).toBeUndefined()
  })

  it('refuses a cite_page call on a truncated page whose rest was not kept, rather than crediting it', async () => {
    vi.mocked(getExtractedPage).mockResolvedValue(truncatedPage)
    scriptModel(cite(QUOTE), answer('1,200.'))

    const { turn } = await ask()

    expect(toolResults(1)).toEqual([{ error: 'cite_page is not available.' }])
    expect(turn.source).toBe('unverified')
    expect(turn).not.toHaveProperty('quotes')
  })
})

// `unverified` looks the same whether cite_page was skipped, rejected or not offered; the log differs.
describe('the log line', () => {
  it('says a quoted answer was quoted', async () => {
    scriptModel(cite(QUOTE), answer('1,200.'))

    await ask()

    expect(logged()).toContain('answered as page')
    expect(logged()).toContain('cite_page: called 1×, 1 verified')
  })

  it('says when the model never called cite_page, even when asked to', async () => {
    scriptModel(answer('About 500.'), answer('About 500.'))

    await ask()

    expect(logged()).toContain('answered as unverified')
    expect(logged()).toContain('cite_page: offered, not called')
    expect(logged()).toContain('asked to quote first')
  })

  it('names the quote that was rejected', async () => {
    scriptModel(cite('The attack works by asking the model to think step by step'), answer('It asks for step by step.'))

    await ask()

    expect(logged()).toContain('answered as unverified')
    expect(logged()).toContain('cite_page: called 1×, 0 verified')
    expect(logged()).toContain('quote not found in page text: "The attack works by asking the model')
  })

  it('names a malformed cite_page call', async () => {
    scriptModel(toolRound('cite_page', { quotes: QUOTE }), answer('1,200.'))

    await ask()

    expect(logged()).toContain('"quotes" must be a non-empty list of strings')
  })

  it('says cite_page was not offered on a cut page whose rest was not kept', async () => {
    vi.mocked(getExtractedPage).mockResolvedValue(truncatedPage)
    scriptModel(answer('1,200.'))

    await ask()

    expect(logged()).toContain('cite_page: not offered (page cut off)')
  })

  it('lists the tools the model called, in order', async () => {
    vi.mocked(searchTavily).mockResolvedValue([{ title: 'Pricing', url: 'https://loomkit.example/pricing', content: 'Pro: $17.50.' }])
    scriptModel(search('Loomkit Pro price'), cite(QUOTE), answer('1,200 testers; Pro is $17.50.'))

    await ask()

    expect(logged()).toContain('Tools: search_site, cite_page')
    expect(logged()).toContain('answered as page+web')
  })
})

// The head plus search_page, quotes checked against the whole page; the answer is past the cut (#5).
describe('a cut-short page whose rest was kept', () => {
  const chunks = (posted: AskPortMessage[]) =>
    posted.filter((m): m is Extract<AskPortMessage, { type: 'ASK_CHUNK' }> => m.type === 'ASK_CHUNK').map((m) => m.delta)

  beforeEach(() => {
    vi.mocked(getExtractedPage).mockResolvedValue(cutPage)
    vi.mocked(getFullPageContent).mockResolvedValue(fullContent)
  })

  describe('answering a question about the part that was cut off', () => {
    it('finds the section with search_page, quotes it, and is labelled from the page, with the quote kept', async () => {
      scriptModel(scan('jailbreak'), cite(TAIL_QUOTE), answer('It starts the dangerous answer before the model can refuse.'))

      const { turn, error } = await ask('How does the jailbreak work?')

      expect(error).toBeUndefined()
      expect(turn).toMatchObject({ source: 'page', quotes: [TAIL_QUOTE] })
    })

    it('does not flag the cut on an answer whose model went looking past it', async () => {
      scriptModel(scan('jailbreak'), cite(TAIL_QUOTE), answer('It starts the dangerous answer before the model can refuse.'))

      const { turn } = await ask('How does the jailbreak work?')

      expect(turn).not.toHaveProperty('truncated')
      expect(turn).not.toHaveProperty('charsOmitted')
    })

    it('gives the model passages with where each starts, and says they can be cited', async () => {
      scriptModel(scan('jailbreak'), cite(TAIL_QUOTE), answer('Done.'))

      await ask('How does the jailbreak work?')

      const [result] = toolResults(1)
      expect(result.note).toBe(PAGE_SEARCH_NOTE)
      const passages = result.passages as { offset: number; text: string }[]
      expect(passages.length).toBeGreaterThan(0)
      expect(passages.some((p) => p.text.includes(TAIL_QUOTE))).toBe(true)
      for (const { offset, text } of passages) expect(fullContent.slice(offset, offset + text.length)).toBe(text)
    })

    it('searches the whole page, so it finds what the head holds too', async () => {
      scriptModel(scan('Dana'), cite('By Dana Reyes, co-founder.'), answer('Dana Reyes.'))

      await ask('Who is Dana?')

      const [result] = toolResults(1)
      expect(result.note).toBe(PAGE_SEARCH_NOTE)
      expect((result.passages as { text: string }[])[0].text).toContain('By Dana Reyes')
    })

    it('accepts a quote from the cut-off part, which the model was never given in the prompt', async () => {
      scriptModel(scan('jailbreak'), cite(TAIL_QUOTE), answer('Done.'))

      await ask('How does the jailbreak work?')

      expect(modelCalls[0].messages[0].content).not.toContain(TAIL_QUOTE)
      expect(toolResults(2)).toEqual([expect.anything(), { verified: [TAIL_QUOTE], note: CITE_DONE_NOTE }])
    })

    it('still rejects a quote that is on neither part of the page', async () => {
      const fake = 'The attack works by asking the model to think step by step'
      scriptModel(scan('jailbreak'), cite(fake), answer('It asks for step by step.'))

      const { turn } = await ask('How does the jailbreak work?')

      expect(toolResults(2)[1].error).toContain('quote not found in page text')
      expect(turn.source).toBe('unverified')
      expect(turn).not.toHaveProperty('quotes')
    })

    it('tells the panel the page is being searched, and for what, before the search runs', async () => {
      scriptModel(scan('jailbreak'), cite(TAIL_QUOTE), answer('Done.'))

      const { posted } = await ask('How does the jailbreak work?')

      const stepAt = posted.findIndex((m) => m.type === 'ASK_STEP' && m.step.kind === 'scanning')
      expect(posted[stepAt]).toEqual({ type: 'ASK_STEP', step: { kind: 'scanning', query: 'jailbreak' } })
      expect(stepAt).toBeLessThan(posted.findIndex((m) => m.type === 'ASK_STEP' && m.step.kind === 'citing'))
    })

    it('sends the same system prompt on every round, so the cached prefix is unchanged', async () => {
      scriptModel(scan('jailbreak'), cite(TAIL_QUOTE), answer('Done.'))

      await ask('How does the jailbreak work?')

      expect(modelCalls).toHaveLength(3)
      const [system] = modelCalls[0].messages
      expect(system.content).toContain(cutPage.content)
      expect(system.content).not.toContain('Life of a Jailbreak')
      for (const call of modelCalls) expect(call.messages[0]).toEqual(system)
    })

    it('counts the search as a tool round, so it and the quote leave the cap room for a second search', async () => {
      scriptModel(scan('refusal'), scan('jailbreak'), cite(TAIL_QUOTE), answer('Done.'))

      const { turn, error } = await ask('How does the jailbreak work?')

      expect(error).toBeUndefined()
      expect(modelCalls.at(-1)?.tools).toBeUndefined() // the forced round: three tool rounds were spent
      expect(turn.source).toBe('page')
    })
  })

  describe('which tools a round is offered', () => {
    it('offers search_page and cite_page next to the site search', async () => {
      scriptModel(answer('1,200.'), answer('1,200.'))

      await ask()

      expect(toolNames(modelCalls[0].tools)).toEqual(['search_site', 'fetch_page', 'search_page', 'cite_page'])
    })

    it('offers them with no Tavily key too, since neither needs the network', async () => {
      vi.mocked(getApiKeys).mockResolvedValue({ nebiusApiKey: 'nebius-key', tavilyApiKey: undefined })
      scriptModel(scan('jailbreak'), cite(TAIL_QUOTE), answer('Done.'))

      const { turn } = await ask('How does the jailbreak work?')

      expect(toolNames(modelCalls[0].tools)).toEqual(['search_page', 'cite_page'])
      expect(turn).toMatchObject({ source: 'page', quotes: [TAIL_QUOTE] })
    })

    it('asks for the whole-text variant of cite_page, whose passages may come from search_page', async () => {
      scriptModel(answer('1,200.'), answer('1,200.'))

      await ask()

      const cite = (modelCalls[0].tools as { function: { name: string; description: string } }[]).find((t) => t.function.name === 'cite_page')
      expect(cite?.function.description).toContain('came from search_page')
      expect(cite?.function.description).toContain('checked against the whole page')
    })

    it('does not offer search_page on a page that reached the model whole', async () => {
      vi.mocked(getExtractedPage).mockResolvedValue(wholePage)
      scriptModel(cite(QUOTE), answer('1,200.'))

      await ask()

      expect(toolNames(modelCalls[0].tools)).toEqual(['search_site', 'fetch_page', 'cite_page'])
      // Distinct from the fetch-escalation clause (#7), which also mentions search_page: no tab-page text.
      expect(modelCalls[0].messages[0].content).not.toContain('call search_page to find them first')
    })

    it('does not even read the kept text for a page that reached the model whole', async () => {
      vi.mocked(getExtractedPage).mockResolvedValue(wholePage)
      scriptModel(cite(QUOTE), answer('1,200.'))

      await ask()

      expect(vi.mocked(getFullPageContent)).not.toHaveBeenCalled()
    })

    it('refuses a search_page call on a page where it was not offered, rather than running it', async () => {
      vi.mocked(getExtractedPage).mockResolvedValue(wholePage)
      scriptModel(scan('jailbreak'), cite(QUOTE), answer('1,200.'))

      const { turn } = await ask()

      expect(toolResults(1)).toEqual([{ error: 'search_page is not available.' }])
      expect(turn.source).toBe('page')
    })
  })

  describe('an answer from the part it was given, without looking past the cut', () => {
    it('is not labelled from the page, even with a verified quote: it could still be about the part that was cut (#5)', async () => {
      scriptModel(cite(QUOTE), answer('There were 1,200 beta testers.'))

      const { turn } = await ask()

      expect(turn.source).toBe('unverified')
      expect(turn).toMatchObject({ truncated: true, charsOmitted: tail.length })
    })

    it('is not labelled page+web either: the web is credited, the page quote is not', async () => {
      vi.mocked(searchTavily).mockResolvedValue([{ title: 'Pricing', url: 'https://loomkit.example/pricing', content: 'Pro: $17.50.' }])
      scriptModel(search('Loomkit Pro price'), cite(QUOTE), answer('1,200 testers; Pro is $17.50.'))

      const { turn } = await ask('How many testers, and how much is Pro?')

      expect(turn.source).toBe('web')
    })

    it('is labelled page+web once the rest was searched, the page was quoted and the web returned something', async () => {
      vi.mocked(searchTavily).mockResolvedValue([{ title: 'Pricing', url: 'https://loomkit.example/pricing', content: 'Pro: $17.50.' }])
      scriptModel(scan('jailbreak'), cite(TAIL_QUOTE), search('Loomkit Pro price'), answer('It starts early; Pro is $17.50.'))

      const { turn } = await ask('How does the jailbreak work, and how much is Pro?')

      expect(turn).toMatchObject({ source: 'page+web', quotes: [TAIL_QUOTE] })
    })
  })

  describe('quoting what the search returned', () => {
    // A page long enough that the search's passages don't reach back to the head's first line.
    const filler = 'lorem ipsum dolor sit amet '.repeat(300)
    const longFull = `${wholePage.content}\n\n${filler}${tail}`
    const longCutPage: ExtractedPage = { ...cutPage, charsOmitted: longFull.length - cutPage.content.length }

    beforeEach(() => {
      vi.mocked(getExtractedPage).mockResolvedValue(longCutPage)
      vi.mocked(getFullPageContent).mockResolvedValue(longFull)
    })

    it('does not label the answer from the page when the model searched, then quoted the head instead of what it found (#5)', async () => {
      scriptModel(scan('jailbreak'), cite(QUOTE), answer('There were 1,200 beta testers.'))

      const { turn } = await ask('How does the jailbreak work?')

      const passages = toolResults(1)[0].passages as { text: string }[]
      expect(passages.length).toBeGreaterThan(0)
      expect(passages.some((p) => p.text.includes(QUOTE))).toBe(false)
      expect(turn.source).toBe('unverified')
      // It did look through the page, so the cut is not what limits the answer.
      expect(turn).not.toHaveProperty('truncated')
    })

    it('labels it from the page when the quote is one of the passages the search returned', async () => {
      scriptModel(scan('jailbreak'), cite(TAIL_QUOTE), answer('It starts the answer before the model can refuse.'))

      const { turn } = await ask('How does the jailbreak work?')

      expect(turn).toMatchObject({ source: 'page', quotes: [TAIL_QUOTE] })
    })

    it('says in the log how many verified quotes came from what the search returned', async () => {
      scriptModel(scan('jailbreak'), cite(QUOTE, TAIL_QUOTE), answer('Both.'))

      await ask('How does the jailbreak work?')

      expect(logged()).toContain('search_page: called 1×')
      expect(logged()).toContain('2 verified')
      expect(logged()).toContain('1 verified quotes from them')
    })
  })

  it('counts a quote of a head passage the search returned, since the model did look the page through for it', async () => {
    scriptModel(scan('Dana'), cite('By Dana Reyes, co-founder.'), answer('Dana Reyes.'))

    const { turn } = await ask('Who is Dana?')

    expect(turn).toMatchObject({ source: 'page', quotes: ['By Dana Reyes, co-founder.'] })
  })

  describe('a search of the rest that finds nothing', () => {
    it('is told so and to try other words, not treated as an error', async () => {
      scriptModel(scan('cryptocurrency'), answer("The page doesn't mention it."))

      const { error } = await ask('What does it say about cryptocurrency?')

      expect(error).toBeUndefined()
      expect(toolResults(1)).toEqual([{ passages: [], note: PAGE_SEARCH_EMPTY_NOTE }])
    })

    it('leaves an honest "the page does not say" alone rather than asking the model to quote it', async () => {
      scriptModel(scan('cryptocurrency'), answer("The page doesn't mention it."))

      const { turn, posted } = await ask('What does it say about cryptocurrency?')

      expect(modelCalls).toHaveLength(2)
      expect(turn).toMatchObject({ content: "The page doesn't mention it.", source: 'unverified' })
      expect(chunks(posted).join('')).toBe("The page doesn't mention it.")
    })

    it('does not credit the search: a quote of the head after it still leaves the answer unverified', async () => {
      scriptModel(scan('cryptocurrency'), cite(QUOTE), answer('There were 1,200 beta testers.'))

      const { turn } = await ask()

      expect(turn.source).toBe('unverified')
    })

    it('does not flag the cut on the answer, since the model did look there', async () => {
      scriptModel(scan('cryptocurrency'), answer("The page doesn't mention it."))

      const { turn } = await ask('What does it say about cryptocurrency?')

      expect(turn).not.toHaveProperty('truncated')
    })
  })

  describe('an answer with no quote behind it', () => {
    it('is discarded and the model asked to quote first, with a way out that includes searching the rest', async () => {
      scriptModel(answer('It asks nicely.'), scan('jailbreak'), cite(TAIL_QUOTE), answer('It starts the answer before the model can refuse.'))

      const { turn, posted } = await ask('How does the jailbreak work?')

      expect(modelCalls[1].messages.at(-1)).toEqual({ role: 'user', content: CITE_NUDGE_CUT })
      expect(chunks(posted).join('')).toBe('It starts the answer before the model can refuse.')
      expect(turn).toMatchObject({ source: 'page', quotes: [TAIL_QUOTE] })
    })

    it('is discarded after a search that found passages too: what it returned is the page, so it needs a quote', async () => {
      scriptModel(scan('jailbreak'), answer('It asks nicely.'), cite(TAIL_QUOTE), answer('It starts the answer before the model can refuse.'))

      const { turn } = await ask('How does the jailbreak work?')

      expect(modelCalls).toHaveLength(4)
      expect(modelCalls[2].messages.at(-1)).toEqual({ role: 'user', content: CITE_NUDGE_CUT })
      expect(turn).toMatchObject({ content: 'It starts the answer before the model can refuse.', source: 'page' })
    })

    it('is asked once, then accepted as unverified', async () => {
      scriptModel(scan('jailbreak'), answer('It asks nicely.'), answer('It asks nicely.'))

      const { turn } = await ask('How does the jailbreak work?')

      expect(modelCalls).toHaveLength(3)
      expect(turn).toMatchObject({ content: 'It asks nicely.', source: 'unverified' })
    })
  })

  describe('the most one search returns', () => {
    it('is a few passages, so a hot page cannot flood the prompt', async () => {
      const filler = 'lorem ipsum dolor sit amet '.repeat(200)
      const busy = wholePage.content + Array.from({ length: 12 }, (_, i) => `\n\n${filler} jailbreak number ${i}`).join('')
      vi.mocked(getFullPageContent).mockResolvedValue(busy)
      scriptModel(scan('jailbreak'), answer('Done.'), answer('Done.'))

      await ask('How does the jailbreak work?')

      const passages = toolResults(1)[0].passages as { text: string }[]
      expect(passages).toHaveLength(PAGE_SEARCH_MAX_PASSAGES)
      expect(passages.reduce((total, p) => total + p.text.length, 0)).toBeLessThanOrEqual(PAGE_SEARCH_MAX_PASSAGES * PAGE_SEARCH_PASSAGE_CHARS)
    })
  })

  describe('the forced final round', () => {
    it('tells the model on this page that cite_page is gone too, and takes search_page away with the other tools', async () => {
      scriptModel(scan('a'), scan('b'), scan('c'), answer("I couldn't find it."))

      await ask('How does the jailbreak work?')

      const forced = modelCalls.at(-1)
      expect(forced?.tools).toBeUndefined()
      expect(forced?.messages.at(-1)).toEqual({ role: 'user', content: FORCE_NUDGE_CITE })
    })
  })

  describe('the log line', () => {
    it('says the model searched the rest, and how many passages it found', async () => {
      scriptModel(scan('jailbreak'), cite(TAIL_QUOTE), answer('Done.'))

      await ask('How does the jailbreak work?')

      expect(logged()).toContain('answered as page')
      expect(logged()).toContain('Tools: search_page, cite_page')
      expect(logged()).toContain('search_page: called 1×, 1 passages, 1 verified quotes from them.')
    })

    it('says search_page was on offer and not called, so an unverified label can be told from a failed search', async () => {
      scriptModel(cite(QUOTE), answer('1,200.'))

      await ask()

      expect(logged()).toContain('answered as unverified')
      expect(logged()).toContain('search_page: offered, not called.')
    })

    it('says nothing about search_page on a page where it is not offered', async () => {
      vi.mocked(getExtractedPage).mockResolvedValue(wholePage)
      scriptModel(cite(QUOTE), answer('1,200.'))

      await ask()

      expect(logged()).not.toContain('search_page:')
    })
  })

  describe('when the rest was not kept after all', () => {
    it('falls back to a plain cut page if the text is gone from storage, though the page said it was kept', async () => {
      vi.mocked(getFullPageContent).mockResolvedValue(undefined)
      scriptModel(answer('1,200.'))

      const { turn } = await ask()

      expect(toolNames(modelCalls[0].tools)).toEqual(['search_site', 'fetch_page'])
      // Distinct from the fetch-escalation clause (#7), which also mentions search_page: no tab-page text.
      expect(modelCalls[0].messages[0].content).not.toContain('call search_page to find them first')
      expect(modelCalls[0].messages[0].content).not.toContain('cite_page')
      expect(turn).toMatchObject({ source: 'unverified', truncated: true })
    })

    it('does not read text the page never said was kept', async () => {
      vi.mocked(getExtractedPage).mockResolvedValue({ ...cutPage, searchable: false })
      scriptModel(answer('1,200.'))

      await ask()

      expect(vi.mocked(getFullPageContent)).not.toHaveBeenCalled()
      expect(toolNames(modelCalls[0].tools)).toEqual(['search_site', 'fetch_page'])
    })
  })
})

describe('a trace for every exit (#18)', () => {
  const traced = () => vi.mocked(appendTrace).mock.calls.map(([trace]) => trace)

  it('ties a finished run to one done trace', async () => {
    scriptModel(cite(QUOTE), answer('1,200.'))
    const { posted } = await ask()
    const done = posted.find((m) => m.type === 'ASK_DONE')

    expect(traced()).toHaveLength(1)
    expect(traced()[0]).toMatchObject({ status: 'done', source: 'page', askedToQuote: false })
    expect(done && 'traceId' in done && done.traceId).toBe(traced()[0].id)
  })

  it('leaves an error trace when the model fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    scriptModel(answer(''))
    const { posted } = await ask()
    const failed = posted.find((m) => m.type === 'ASK_ERROR')

    expect(traced()).toHaveLength(1)
    expect(traced()[0].status).toBe('error')
    expect(failed && 'traceId' in failed && failed.traceId).toBe(traced()[0].id)
  })

  it('leaves an error trace with no API key', async () => {
    vi.mocked(getApiKeys).mockResolvedValue({ nebiusApiKey: '', tavilyApiKey: undefined })
    const { posted } = await ask()

    expect(traced().map((t) => t.status)).toEqual(['error'])
    expect(posted[0]).toMatchObject({ type: 'ASK_ERROR', traceId: traced()[0].id })
  })

  it('leaves an error trace with no page', async () => {
    vi.mocked(getExtractedPage).mockResolvedValue(undefined)
    const { posted } = await ask()

    expect(traced().map((t) => t.status)).toEqual(['error'])
    expect(posted[0]).toMatchObject({ type: 'ASK_ERROR', traceId: traced()[0].id })
  })

  it('leaves a panel-closed trace, and posts nothing, when the panel goes before a round', async () => {
    const posted: AskPortMessage[] = []
    const port = {
      postMessage: (message: AskPortMessage) => posted.push(message),
      onDisconnect: { addListener: (listener: () => void) => listener() },
    } as unknown as chrome.runtime.Port

    await runAgentLoop(port, 1, 'How many beta testers were there?')

    expect(posted).toEqual([])
    expect(vi.mocked(streamAgentTurn)).not.toHaveBeenCalled()
    expect(traced().map((t) => t.status)).toEqual(['panel-closed'])
  })

  it('aborts the in-flight request and stores nothing when the panel disconnects mid-round', async () => {
    let disconnect = () => {}
    const posted: AskPortMessage[] = []
    const port = {
      postMessage: (message: AskPortMessage) => posted.push(message),
      onDisconnect: { addListener: (listener: () => void) => (disconnect = listener) },
    } as unknown as chrome.runtime.Port
    let seen: AbortSignal | undefined
    vi.mocked(streamAgentTurn).mockImplementation(
      (_key, _messages, { signal }) =>
        new Promise((_resolve, reject) => {
          seen = signal
          signal?.addEventListener('abort', () => reject(new Error('aborted')))
          disconnect()
        }),
    )

    await runAgentLoop(port, 1, 'How many beta testers were there?')

    expect(seen?.aborted).toBe(true)
    expect(posted).toEqual([])
    expect(traced().map((t) => t.status)).toEqual(['panel-closed'])
  })

  it('records each round: a verified quote, then the answer', async () => {
    scriptModel(
      { ...cite(QUOTE), model: 'nemotron', usage: { promptTokens: 10, completionTokens: 2 }, finishReason: 'tool_calls', reasoning: 'hmm' },
      answer('1,200.'),
    )
    await ask()
    const [first, second] = traced()[0].rounds

    expect(traced()[0].rounds).toHaveLength(2)
    expect(first).toMatchObject({ index: 0, model: 'nemotron', finishReason: 'tool_calls', forced: false })
    expect(first.usage).toEqual({ promptTokens: 10, completionTokens: 2 })
    expect(first.reasoning).toEqual({ length: 3 })
    expect(first.toolCalls).toEqual([expect.objectContaining({ name: 'cite_page', ok: true, summary: '1 quote, 1 verified' })])
    expect(first.toolCalls[0].args).toBeUndefined()
    expect(second).toMatchObject({ index: 1, toolCalls: [], usage: undefined })
  })

  it('keeps the discarded answer of a quote-first nudge, redacted unless the toggle is on', async () => {
    scriptModel(answer('Unquoted guess.'), cite(QUOTE), answer('1,200.'))
    await ask()

    expect(traced()[0].askedToQuote).toBe(true)
    expect(traced()[0].rounds[0].discardedAnswer).toEqual({ length: 'Unquoted guess.'.length })

    vi.mocked(appendTrace).mockClear()
    vi.mocked(getTraceContentEnabled).mockResolvedValue(true)
    scriptModel(answer('Unquoted guess.'), cite(QUOTE), answer('1,200.'))
    await ask()

    expect(traced()[0].rounds[0].discardedAnswer?.text).toBe('Unquoted guess.')
    expect(traced()[0].rounds[1].toolCalls[0].args).toEqual({ quotes: [QUOTE] })
  })

  it('records a search then a fetch round', async () => {
    const url = 'https://loomkit.example/pricing'
    vi.mocked(searchTavily).mockResolvedValue([{ title: 'Pricing', url, content: 'Pro: $17.50.' }])
    vi.mocked(extractTavily).mockResolvedValue('Pro: $17.50 per user per month.')
    scriptModel(search('pricing'), toolRound('fetch_page', { url }), answer('$17.50.'))
    await ask()

    expect(traced()[0].rounds.map((r) => r.toolCalls.map((t) => t.summary))).toEqual([
      ['1 results found'],
      ['fetched 31 chars'],
      [],
    ])
  })

  it('records the forced final round and the nudges it sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const rounds = Array.from({ length: MAX_TOOL_ROUNDS }, () => search('pricing'))
    vi.mocked(searchTavily).mockResolvedValue([])
    scriptModel(...rounds, search('again'), search('again'))
    await ask()
    const trace = traced()[0]

    expect(trace.status).toBe('error')
    expect(trace.forcedNudgeSent).toBe(true)
    expect(trace.forcedRetrySent).toBe(true)
    expect(trace.rounds.filter((r) => r.forced)).toHaveLength(2)
    expect(trace.rounds.at(-1)?.toolCalls).toEqual([])
  })

  it('keeps the rounds so far on an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    scriptModel(cite(QUOTE), answer(''))
    await ask()

    expect(traced()[0].status).toBe('error')
    expect(traced()[0].rounds).toHaveLength(2)
  })

  it('still answers when the trace cannot be stored', async () => {
    vi.mocked(appendTrace).mockResolvedValue(undefined)
    vi.mocked(getTraceContentEnabled).mockRejectedValue(new Error('storage gone'))
    scriptModel(cite(QUOTE), answer('1,200.'))

    const { turn, error } = await ask()

    expect(error).toBeUndefined()
    expect(turn.source).toBe('page')
    expect(traced()[0].question.text).toBeUndefined()
  })
})
