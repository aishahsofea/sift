import { FETCHED_PAGE_CHAR_LIMIT, MAX_TOOL_ROUNDS, PAGE_SEARCH_FETCH_PASSAGES } from '../../shared/constants'
import type { AskPortMessage } from '../../shared/messages'
import type { AgentTrace, AgentTraceToolCall, ChatTurn, ExtractedPage } from '../../shared/types'
import { capSelection, truncate } from '../../shared/truncate'
import { appendHistoryTurns, dropLastHistoryTurns, getExtractedPage, getFullPageContent, getHistory } from '../history/sessionHistory'
import { appendTrace } from '../history/agentTraces'
import { getApiKeys, getTraceContentEnabled } from '../keys'
import { streamAgentTurn } from '../nebius/client'
import { assembleAgentMessages, pageText, type ChatMessage } from '../nebius/promptAssembly'
import { parseToolCall, type ParsedToolCall } from '../nebius/schema'
import {
  CITE_DONE_NOTE,
  CITE_NUDGE,
  CITE_NUDGE_CUT,
  CITE_PAGE,
  CITE_PARTIAL_NOTE,
  CITE_RECOVERY_HINT,
  containsToolMarkup,
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
  SEARCH_PAGE,
  SEARCH_PAGE_TOOL,
  SEARCH_SITE,
  toolsFor,
} from '../nebius/tools'
import { extractTavily, searchTavily } from '../tavily/client'
import { scopeToDomain } from '../tavily/scopeToDomain'
import { deriveSource } from './answerSource'
import { stripCitationMarkers } from './stripMarkers'
import { searchPage } from './searchPage'
import {
  createTraceRecorder,
  finalizeTrace,
  fingerprintPrompt,
  recordRound,
  summarizeToolCall,
  type FinalizeOutcome,
  type TraceRecorder,
} from './traceRecorder'
import { collapseWhitespace, verifyQuotes } from './verifyQuotes'

// State the loop carries across rounds, scoped to this one question.
interface LoopState {
  /** URLs a search_site call returned this turn — the only URLs fetch_page accepts. */
  allowedUrls: Set<string>
  /** Whether a tool actually returned something, which is what "from the web" means. */
  usedWeb: boolean
  /** Quotes cite_page was given that are in the page text — what "from the page" now rests on (ADR 0005). */
  verifiedQuotes: Set<string>
  /** Tools the model called this turn, in order. Whether any were is what decides if an uncited answer is discarded. */
  toolsCalled: string[]
  /** An uncited answer was already thrown away and the model asked to quote first. It is asked once. */
  askedToQuote: boolean
  /** search_page calls that ran this turn. Any at all means the model did look through the page. */
  pageSearches: number
  /** Passages those calls returned. None means the page has nothing on those words. */
  pagePassages: number
  /** What those passages said, whitespace collapsed: a cut page's "from the page" rests on a quote taken from one (ADR 0006). */
  passageTexts: string[]
  /**
   * The full text of the most recent fetch_page result that came back cut (#7),
   * turn-scoped like the rest of this state (ADR 0004): a later question re-fetches
   * rather than reusing a stale one. Set, never cleared, by a cut fetch — search_page
   * searches this in preference to the tab page whenever it is set, since a cut fetch is
   * the most recent thing the model asked to read.
   */
  fetchedFullContent: string | undefined
  /** What went wrong with tool calls (rejected quotes, malformed calls). Only feeds the log line. */
  problems: string[]
}

// Everything a tool call needs besides its own arguments.
interface ToolContext {
  port: chrome.runtime.Port
  /** Aborts when the panel disconnects (closed, or Stop pressed), cutting any request in flight. */
  signal: AbortSignal
  page: ExtractedPage
  /** Absent when no Tavily key is configured: the web tools then refuse rather than run. */
  tavilyApiKey: string | undefined
  /** The demo proxy's /tavily path when the key is an install ID. */
  tavilyBaseUrl?: string
  /** Whether cite_page was offered this turn. A call to it when it wasn't is refused. */
  citeEnabled: boolean
  /** Whether search_page was offered this turn, which is also whether `fullContent` is there to search. */
  pageSearchEnabled: boolean
  /** The whole text of a page the prompt holds only the start of, when it was kept (#11). */
  fullContent: string | undefined
  /** What a cite_page quote is checked against: the page as the prompt presents it, the whole of it when the text was kept. */
  quotable: string
  state: LoopState
  recorder: TraceRecorder
}

export async function runAgentLoop(
  port: chrome.runtime.Port,
  tabId: number,
  question: string,
  rewind = 0,
  selection?: string,
): Promise<void> {
  // Panel closed or Stop dropped the port: abort in-flight work and run no more paid rounds.
  let panelGone = false
  const abort = new AbortController()
  port.onDisconnect.addListener(() => {
    panelGone = true
    abort.abort()
  })

  // Made before the try so every exit, the catch included, can leave a trace (#18).
  const quoted = selection ? capSelection(selection).text : undefined
  const recorder = createTraceRecorder({ tabId, question, selection: quoted, contentEnabled: await readTraceToggle() })

  try {
    const { nebiusApiKey, tavilyApiKey, nebiusBaseUrl, tavilyBaseUrl } = await getApiKeys()
    if (!nebiusApiKey) {
      const message = 'Add your Nebius API key in Options before asking questions.'
      await persistTrace(recorder, { status: 'error' })
      post(port, { type: 'ASK_ERROR', message, traceId: recorder.id })
      return
    }

    const page = await getExtractedPage(tabId)
    if (!page) {
      await persistTrace(recorder, { status: 'error' })
      post(port, {
        type: 'ASK_ERROR',
        message: 'No page content available yet. Try reopening the side panel on this tab.',
        traceId: recorder.id,
      })
      return
    }

    // Without a Tavily key the web tools can't run, so they aren't offered.
    const searchEnabled = Boolean(tavilyApiKey)
    // Local, so a missing Tavily key keeps search_page; storage may be cleared, so check the text (#11).
    const fullContent = page.truncated && page.searchable ? await getFullPageContent(tabId) : undefined
    const pageSearchEnabled = fullContent !== undefined
    // A head quote can't show the answer avoided the cut part (deriveSource), so cite_page needs the rest.
    const citeEnabled = !page.truncated || pageSearchEnabled
    const options = { searchEnabled, citeEnabled, pageSearchEnabled }
    const tools = toolsFor(options)
    // Before the history is read, so the prompt never sees the turns being replaced.
    if (rewind > 0) await dropLastHistoryTurns(tabId, rewind)
    const history = await getHistory(tabId)
    const messages = assembleAgentMessages(page, history, question, options, quoted)
    const state: LoopState = {
      allowedUrls: new Set(),
      usedWeb: false,
      verifiedQuotes: new Set(),
      toolsCalled: [],
      askedToQuote: false,
      pageSearches: 0,
      pagePassages: 0,
      passageTexts: [],
      fetchedFullContent: undefined,
      problems: [],
    }
    // Checked against the whole page, including what search_page found.
    const quotable = pageText(page, fullContent)
    const context: ToolContext = { port, signal: abort.signal, page, tavilyApiKey, tavilyBaseUrl, citeEnabled, pageSearchEnabled, fullContent, quotable, state, recorder }

    recorder.page = {
      length: page.content.length,
      truncated: page.truncated,
      charsOmitted: page.charsOmitted,
      extractionMethod: page.extractionMethod,
      searchable: Boolean(page.searchable),
    }
    recorder.toolsOffered = tools.map((tool) => tool.function.name)
    Object.assign(recorder, fingerprintPrompt(systemPromptText(messages), page.content, tools))

    // Rounds that ran tools; an answer discarded for want of a quote doesn't count.
    let toolRounds = 0
    let quoteNudge: ChatMessage | undefined
    let forcedRetried = false

    for (;;) {
      if (panelGone) {
        // No one to post to, but the run still happened.
        await persistTrace(recorder, { status: 'panel-closed' })
        return
      }
      // Past the cap tools come off and a one-off nudge goes on, never written to history (ADR 0003).
      const forced = toolRounds >= MAX_TOOL_ROUNDS
      const turnMessages: ChatMessage[] = forced
        ? [
            ...messages,
            { role: 'user', content: citeEnabled ? FORCE_NUDGE_CITE : FORCE_NUDGE },
            ...(forcedRetried ? [{ role: 'user' as const, content: FORCE_RETRY }] : []),
          ]
        : quoteNudge
          ? [...messages, quoteNudge]
          : messages
      quoteNudge = undefined
      // One-off nudges aren't in history (ADR 0003), so the trace is where they show.
      if (forced) {
        recorder.forcedNudgeSent = true
        if (forcedRetried) recorder.forcedRetrySent = true
      }

      // A cut fetch_page result adds search_page for the turn (#7); spliced so citeEnabled tracks the tab.
      const roundTools = pageSearchEnabled || state.fetchedFullContent === undefined ? tools : [...tools, SEARCH_PAGE_TOOL]

      const roundStart = Date.now()
      const turn = await streamAgentTurn(nebiusApiKey, turnMessages, {
        baseUrl: nebiusBaseUrl,
        signal: abort.signal,
        tools: forced || !roundTools.length ? undefined : roundTools,
        // An answer that is about to be thrown away is not shown while it is written.
        onContent: (delta) => {
          if (!mustQuoteFirst(context)) post(port, { type: 'ASK_CHUNK', delta })
        },
      })
      const { content, toolCalls } = turn
      const record = (extra: { discardedAnswer?: string; toolCalls?: AgentTraceToolCall[] }) =>
        recordRound(recorder, {
          index: recorder.rounds.length,
          model: turn.model ?? 'unknown',
          usage: turn.usage,
          finishReason: turn.finishReason,
          timing: turn.timing ?? { durationMs: Date.now() - roundStart },
          forced,
          reasoning: turn.reasoning,
          toolCalls: extra.toolCalls ?? [],
          discardedAnswer: extra.discardedAnswer,
        })

      if (!toolCalls.length) {
        record({ discardedAnswer: mustQuoteFirst(context) ? content : undefined })
        if (mustQuoteFirst(context)) {
          state.askedToQuote = true
          recorder.askedToQuote = true
          quoteNudge = { role: 'user', content: pageSearchEnabled ? CITE_NUDGE_CUT : CITE_NUDGE }
          post(port, { type: 'ASK_STEP', step: { kind: 'citing' } })
          continue
        }
        await finish(context, tabId, question, quoted, content)
        return
      }

      if (forced) {
        record({})
        // Nothing it asked for ran, so a cite_page call earns no label; retry once.
        if (!forcedRetried) {
          forcedRetried = true
          continue
        }
        throw new Error('The model kept searching instead of answering.')
      }
      toolRounds++

      // Echo the turn without reasoning (Nebius rejects it on follow-ups), then answer each tool call.
      messages.push({
        role: 'assistant',
        content,
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.argsText },
        })),
      })

      const traced: AgentTraceToolCall[] = []
      for (const call of toolCalls) {
        state.toolsCalled.push(call.name)
        const parsed = parseToolCall(call)
        const output = await runTool(context, parsed)
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) })
        traced.push(summarizeToolCall(call.name, parsed.ok ? parsed.args : undefined, output, recorder.contentEnabled))
      }
      record({ toolCalls: traced })
    }
  } catch (error) {
    if (panelGone) {
      // The abort surfaces as a thrown fetch error; it is the stop, not a failure.
      await persistTrace(recorder, { status: 'panel-closed' })
      return
    }
    console.error(`[Sift] agent loop failed for tab ${tabId}:`, error)
    await persistTrace(recorder, { status: 'error' })
    post(port, {
      type: 'ASK_ERROR',
      message: error instanceof Error ? error.message : 'Something went wrong answering that.',
      traceId: recorder.id,
    })
  }
}

// Asks the model to quote first (ADR 0005): quoting a written answer finds merely related passages (#5).
function mustQuoteFirst({ citeEnabled, state }: ToolContext): boolean {
  if (!citeEnabled || state.askedToQuote) return false
  if (!state.toolsCalled.every((name) => name === SEARCH_PAGE)) return false
  // A page search with no hits leaves nothing quotable, so asking would waste a round.
  return !(state.pageSearches > 0 && state.pagePassages === 0)
}

async function finish(
  context: ToolContext,
  tabId: number,
  question: string,
  selection: string | undefined,
  content: string,
): Promise<void> {
  const { port, page, state, recorder } = context
  const answer = stripCitationMarkers(content).trimEnd()
  if (!answer) {
    throw new Error('Nebius returned no answer content.')
  }
  // Raw tool-call markup means no tool parser ran; don't render it as the answer (ADR 0003).
  if (containsToolMarkup(answer)) {
    throw new Error('The model returned an unparsed tool call instead of an answer.')
  }

  // Derived from what happened, not the model's claim (ADR 0001); "page" needs a handler-found quote.
  const quotes = [...state.verifiedQuotes]
  const source = deriveSource({
    usedWeb: state.usedWeb,
    quoteVerified: quotes.length > 0,
    pageTruncated: page.truncated,
    quotedSearchResult: quotesFromSearch(state) > 0,
  })

  // Persisted and posted as one object so the panel matches a reload; the cut is flagged only if it limits.
  const turn: ChatTurn = {
    role: 'assistant',
    content: answer,
    source,
    ...(quotes.length ? { quotes, url: page.url } : {}),
    ...(page.truncated && state.pageSearches === 0 ? { truncated: true, charsOmitted: page.charsOmitted } : {}),
  }

  await appendHistoryTurns(tabId, [{ role: 'user', content: question, ...(selection ? { selection } : {}) }, turn])
  const trace = await persistTrace(recorder, {
    status: 'done',
    answer,
    source,
    sourceFacts: {
      usedWeb: state.usedWeb,
      quoteVerified: quotes.length > 0,
      pageTruncated: page.truncated,
      quotedSearchResult: quotesFromSearch(state) > 0,
    },
  })
  logTurn(trace, state)
  post(port, { type: 'ASK_DONE', turn, traceId: recorder.id })
}

// The toggle is a preference, not a reason to fail a run: unreadable storage means off.
async function readTraceToggle(): Promise<boolean> {
  try {
    return await getTraceContentEnabled()
  } catch {
    return false
  }
}

// The manifest is absent outside a real extension context.
function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version
  } catch {
    return 'unknown'
  }
}

// Never rejects (appendTrace swallows storage failures), so a trace can't cost the answer.
async function persistTrace(recorder: TraceRecorder, outcome: Omit<FinalizeOutcome, 'extensionVersion'>): Promise<AgentTrace> {
  const trace = finalizeTrace(recorder, { ...outcome, extensionVersion: extensionVersion() })
  await appendTrace(trace)
  return trace
}

function systemPromptText(messages: ChatMessage[]): string {
  const first = messages[0]
  return first?.role === 'system' && typeof first.content === 'string' ? first.content : ''
}

// One log line per answer, to tell why `unverified` happened on a real page.
function logTurn(trace: AgentTrace, state: LoopState): void {
  const toolsCalled = trace.rounds.flatMap((round) => round.toolCalls.map((call) => call.name))
  const offered = trace.toolsOffered ?? []
  const cited = toolsCalled.filter((name) => name === CITE_PAGE).length
  const cite = !offered.includes(CITE_PAGE)
    ? 'not offered (page cut off)'
    : cited === 0
      ? 'offered, not called'
      : `called ${cited}×, ${state.verifiedQuotes.size} verified`
  // Only on a page whose cut-off part could be searched: says whether the model looked.
  const pageSearch = !offered.includes(SEARCH_PAGE)
    ? ''
    : state.pageSearches === 0
      ? ' search_page: offered, not called.'
      : ` search_page: called ${state.pageSearches}×, ${state.pagePassages} passages, ${quotesFromSearch(state)} verified quotes from them.`
  const tools = toolsCalled.length ? toolsCalled.join(', ') : 'none'
  const asked = trace.askedToQuote ? ' First answer skipped cite_page; asked to quote first.' : ''
  const problems = state.problems.length ? ` Problems: ${state.problems.join(' | ')}` : ''
  console.log(`[Sift] tab ${trace.tabId} answered as ${trace.source}. Tools: ${tools}. cite_page: ${cite}.${pageSearch}${asked}${problems}`)
}

// Runs one tool call; failures return an error object so the model can correct itself.
async function runTool(context: ToolContext, call: ParsedToolCall): Promise<unknown> {
  const { port, page, tavilyApiKey, tavilyBaseUrl, citeEnabled, state } = context

  if (!call.ok) {
    state.problems.push(call.error)
    return { error: call.error }
  }

  if (call.name === CITE_PAGE) {
    return citePage(context, call.args.quotes)
  }

  // Before the key check below: it searches the page's own text, so it runs with none.
  if (call.name === SEARCH_PAGE) {
    return searchWholePage(context, call.args.query)
  }

  // Re-checked, not asserted: a web call without a key becomes a tool error, not a thrown loop.
  if (!tavilyApiKey) {
    return { error: 'Search is not configured.' }
  }

  if (call.name === SEARCH_SITE) {
    const domain = scopeToDomain(page.url)
    post(port, { type: 'ASK_STEP', step: { kind: 'searching', domain, query: call.args.query } })

    const results = await searchTavily(tavilyApiKey, call.args.query, page.url, tavilyBaseUrl, context.signal)
    for (const result of results) state.allowedUrls.add(result.url)
    if (results.length) state.usedWeb = true
    return { results, ...(citeEnabled ? { note: SEARCH_NOTE } : {}) }
  }

  // Allowlist enforced here, not by prompt: page text is untrusted, a free-form URL exfiltrates (ADR 0004).
  if (!state.allowedUrls.has(call.args.url)) {
    return { error: 'fetch_page only accepts URLs returned by search_site.' }
  }

  post(port, { type: 'ASK_STEP', step: { kind: 'reading', url: call.args.url } })
  const raw = await extractTavily(tavilyApiKey, call.args.url, tavilyBaseUrl, context.signal)
  if (!raw) {
    return { error: "That page couldn't be read. Use the search snippets, or search again." }
  }
  state.usedWeb = true

  // Cut like the tab page (FETCHED_PAGE_CHAR_LIMIT), keeping the rest for search_page (#7).
  const fetched = truncate(raw, FETCHED_PAGE_CHAR_LIMIT)
  if (fetched.truncated) state.fetchedFullContent = raw
  // FETCH_NOTE_CUT shows regardless of citeEnabled: it's the only place the model learns the fetch was cut.
  const note = fetched.truncated ? FETCH_NOTE_CUT(fetched.charsOmitted) : citeEnabled ? FETCH_NOTE : undefined
  return { url: call.args.url, content: fetched.content, ...(note ? { note } : {}) }
}

// A cut fetch_page result beats the tab page (#7); fetched passages never feed cite_page (ADR 0005).
function searchWholePage({ port, page, pageSearchEnabled, fullContent, state }: ToolContext, query: string): unknown {
  if (state.fetchedFullContent !== undefined) {
    post(port, { type: 'ASK_STEP', step: { kind: 'scanning', query } })
    const passages = searchPage(state.fetchedFullContent, query, FETCHED_PAGE_CHAR_LIMIT, {
      // The head is already in the model's context, so every slot goes past the cut (#27).
      pastCutOnly: true,
      maxPassages: PAGE_SEARCH_FETCH_PASSAGES,
    })
    state.pageSearches++
    state.pagePassages += passages.length
    return { passages, note: passages.length ? PAGE_SEARCH_NOTE_FETCHED : PAGE_SEARCH_EMPTY_NOTE_FETCHED }
  }

  if (!pageSearchEnabled || fullContent === undefined) {
    state.problems.push('search_page is not available.')
    return { error: 'search_page is not available.' }
  }

  post(port, { type: 'ASK_STEP', step: { kind: 'scanning', query } })

  // The part past the prompt gets its own slots so a head full of the word can't fill the result.
  const passages = searchPage(fullContent, query, page.content.length)
  state.pageSearches++
  state.pagePassages += passages.length
  for (const { text } of passages) state.passageTexts.push(collapseWhitespace(text))
  return { passages, note: passages.length ? PAGE_SEARCH_NOTE : PAGE_SEARCH_EMPTY_NOTE }
}

// Verified quotes taken from a search_page passage this turn.
function quotesFromSearch(state: LoopState): number {
  return [...state.verifiedQuotes].filter((quote) => state.passageTexts.some((text) => text.includes(quote))).length
}

// Fabricated quotes are a recoverable error, never the enforcement point (ADR 0005).
function citePage({ port, citeEnabled, quotable, state }: ToolContext, quotes: string[]): unknown {
  if (!citeEnabled) {
    state.problems.push('cite_page is not available.')
    return { error: 'cite_page is not available.' }
  }

  post(port, { type: 'ASK_STEP', step: { kind: 'citing' } })

  const { verified, errors } = verifyQuotes(quotable, quotes)
  for (const quote of verified) state.verifiedQuotes.add(quote)
  state.problems.push(...errors)

  if (!state.verifiedQuotes.size) {
    return { verified, error: `${errors.join('; ')}. ${CITE_RECOVERY_HINT}` }
  }
  return errors.length
    ? { verified, error: errors.join('; '), note: CITE_PARTIAL_NOTE }
    : { verified, note: CITE_DONE_NOTE }
}

function post(port: chrome.runtime.Port, message: AskPortMessage): void {
  try {
    port.postMessage(message)
  } catch {
    // Panel disconnected; the loop stops next round.
  }
}
