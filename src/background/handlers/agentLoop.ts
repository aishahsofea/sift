import { FETCHED_PAGE_CHAR_LIMIT, MAX_TOOL_ROUNDS } from '../../shared/constants'
import type { AskPortMessage } from '../../shared/messages'
import type { AgentTrace, AgentTraceToolCall, ChatTurn, ExtractedPage } from '../../shared/types'
import { truncate } from '../../shared/truncate'
import { appendHistoryTurns, getExtractedPage, getFullPageContent, getHistory } from '../history/sessionHistory'
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
  page: ExtractedPage
  /** Absent when no Tavily key is configured: the web tools then refuse rather than run. */
  tavilyApiKey: string | undefined
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

export async function runAgentLoop(port: chrome.runtime.Port, tabId: number, question: string): Promise<void> {
  // The panel can close mid-loop (a search round takes seconds). Once it has, no
  // one is listening, so stop before starting another paid round.
  let panelGone = false
  port.onDisconnect.addListener(() => {
    panelGone = true
  })

  // Made before the try so every exit, the catch included, can leave a trace (#18).
  const recorder = createTraceRecorder({ tabId, question, contentEnabled: await readTraceToggle() })

  try {
    const { nebiusApiKey, tavilyApiKey } = await getApiKeys()
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
    // The rest of a page the prompt holds only the start of, when it was kept (#11).
    // Neither the panel's word for it (`searchable`) nor the text alone is trusted: the
    // text can be gone if storage was cleared, and then the page is what it was before
    // #11 — a head, with nothing to search and nothing beyond it to check a quote
    // against. Local, so a missing Tavily key doesn't take search_page away either.
    const fullContent = page.truncated && page.searchable ? await getFullPageContent(tabId) : undefined
    const pageSearchEnabled = fullContent !== undefined
    // cite_page needs no network, so a missing key doesn't take it away. A cut page
    // does, unless its rest can be searched: a quote from the head alone can't show
    // the answer wasn't about the part that was cut (deriveSource), so asking for it
    // would cost a round for nothing.
    const citeEnabled = !page.truncated || pageSearchEnabled
    const options = { searchEnabled, citeEnabled, pageSearchEnabled }
    const tools = toolsFor(options)
    const history = await getHistory(tabId)
    const messages = assembleAgentMessages(page, history, question, options)
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
    // A quote is checked against the whole page, not only the part the prompt holds:
    // the model can quote what search_page found there.
    const quotable = pageText(page, fullContent)
    const context: ToolContext = { port, page, tavilyApiKey, citeEnabled, pageSearchEnabled, fullContent, quotable, state, recorder }

    recorder.page = {
      length: page.content.length,
      truncated: page.truncated,
      charsOmitted: page.charsOmitted,
      extractionMethod: page.extractionMethod,
      searchable: Boolean(page.searchable),
    }
    recorder.toolsOffered = tools.map((tool) => tool.function.name)
    Object.assign(recorder, fingerprintPrompt(systemPromptText(messages), page.content, tools))

    // Rounds that ran tools. An answer thrown away for want of a quote isn't one, so
    // it doesn't eat into the cap.
    let toolRounds = 0
    let quoteNudge: ChatMessage | undefined
    let forcedRetried = false

    for (;;) {
      if (panelGone) {
        // No one to post to, but the run still happened.
        await persistTrace(recorder, { status: 'panel-closed' })
        return
      }
      // Past the cap the tools come off and a nudge goes on, for this request only
      // — the nudge is never written to history (ADR 0003). The ask to quote first is
      // the same kind of one-off.
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
      // These one-off nudges never reach chat history (ADR 0003), so the trace is the
      // only place they show.
      if (forced) {
        recorder.forcedNudgeSent = true
        if (forcedRetried) recorder.forcedRetrySent = true
      }

      // search_page comes onto the table for the rest of the turn once a fetch_page
      // result comes back cut (#7), even on a page where pageSearchEnabled was false —
      // spliced in here rather than by changing toolsFor()'s signature, so citeEnabled's
      // cut/whole wording choice stays pinned to the tab page, untouched by fetch state.
      // Already in `tools` when pageSearchEnabled, so it is never added twice.
      const roundTools = pageSearchEnabled || state.fetchedFullContent === undefined ? tools : [...tools, SEARCH_PAGE_TOOL]

      const roundStart = Date.now()
      const turn = await streamAgentTurn(nebiusApiKey, turnMessages, {
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
        await finish(context, tabId, question, content)
        return
      }

      if (forced) {
        record({})
        // Nothing it asked for is run, so a cite_page call here earns no label. Once more,
        // then it is the error it always was.
        if (!forcedRetried) {
          forcedRetried = true
          continue
        }
        throw new Error('The model kept searching instead of answering.')
      }
      toolRounds++

      // Echo the assistant turn back without its reasoning — the field Nebius
      // rejects on a follow-up round — then answer every tool call it contains.
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
    console.error(`[Sift] agent loop failed for tab ${tabId}:`, error)
    await persistTrace(recorder, { status: 'error' })
    post(port, {
      type: 'ASK_ERROR',
      message: error instanceof Error ? error.message : 'Something went wrong answering that.',
      traceId: recorder.id,
    })
  }
}

// A plain answer to a page question, with no tool called, has no quote to verify. It
// can't be quoted for afterwards: a model asked to cite an answer it already wrote
// finds passages that merely relate to it, which is #5's failure labelled `page`. So it
// is thrown away, once, and the model is asked to quote first (ADR 0005). Not when the
// model searched the web, even to no result: that answer is about the search, not the
// page. search_page is no such search: what it returns is the page, so an answer written
// after only that has nothing to verify either, and is asked to quote like any other.
function mustQuoteFirst({ citeEnabled, state }: ToolContext): boolean {
  if (!citeEnabled || state.askedToQuote) return false
  if (!state.toolsCalled.every((name) => name === SEARCH_PAGE)) return false
  // A search of the rest of the page that found nothing leaves no passage the model
  // could quote to lift the label: a quote from the part it was given can't (deriveSource).
  // Asking anyway would only cost a round on an honest "the page doesn't say".
  return !(state.pageSearches > 0 && state.pagePassages === 0)
}

async function finish(context: ToolContext, tabId: number, question: string, content: string): Promise<void> {
  const { port, page, state, recorder } = context
  const answer = content.trimEnd()
  if (!answer) {
    throw new Error('Nebius returned no answer content.')
  }
  // Raw tool-call markup in content means no tool parser was active; rendering it
  // would show markup as the answer (ADR 0003).
  if (containsToolMarkup(answer)) {
    throw new Error('The model returned an unparsed tool call instead of an answer.')
  }

  // Derived from what actually happened, never from a claim in the model's own
  // output (ADR 0001) — and not from the absence of a tool call alone: "from the
  // page" needs a quote the handler found in it (ADR 0005).
  const quotes = [...state.verifiedQuotes]
  const source = deriveSource({
    usedWeb: state.usedWeb,
    quoteVerified: quotes.length > 0,
    pageTruncated: page.truncated,
    quotedSearchResult: quotesFromSearch(state) > 0,
  })

  // One object is both persisted and posted, so the panel shows live exactly what a
  // reload will read back from history. The cut is only flagged on an answer when it
  // still limits it: a model that searched the page, even to no result, did look there.
  const turn: ChatTurn = {
    role: 'assistant',
    content: answer,
    source,
    ...(quotes.length ? { quotes } : {}),
    ...(page.truncated && state.pageSearches === 0 ? { truncated: true, charsOmitted: page.charsOmitted } : {}),
  }

  await appendHistoryTurns(tabId, [{ role: 'user', content: question }, turn])
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

// One line per answer, in the style extractPage logs in. `unverified` looks the same
// in the panel whether the model skipped cite_page, cited and had every quote
// rejected, or was never offered the tool (a cut page); this is how to tell them apart
// on a real page, which the fixtures in scripts/ can't do. What was offered, called and
// asked comes from the trace; the verified-quote and passage counts and the problems are
// loop state the trace only carries as prose, so they still come from there.
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

// Runs one validated tool call and returns whatever should go back as its result.
// Every failure path returns an error object rather than throwing: the model gets
// the message as the tool result and can correct itself on the next round.
async function runTool(context: ToolContext, call: ParsedToolCall): Promise<unknown> {
  const { port, page, tavilyApiKey, citeEnabled, state } = context

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

  // The key is re-checked rather than asserted: a web tool call with no key to run
  // it becomes a tool-role error like any other, never a thrown loop.
  if (!tavilyApiKey) {
    return { error: 'Search is not configured.' }
  }

  if (call.name === SEARCH_SITE) {
    const domain = scopeToDomain(page.url)
    post(port, { type: 'ASK_STEP', step: { kind: 'searching', domain, query: call.args.query } })

    const results = await searchTavily(tavilyApiKey, call.args.query, page.url)
    for (const result of results) state.allowedUrls.add(result.url)
    if (results.length) state.usedWeb = true
    return { results, ...(citeEnabled ? { note: SEARCH_NOTE } : {}) }
  }

  // fetch_page. The allowlist is enforced here, next to the loop state, and is
  // never a prompt instruction: page text is untrusted and a free-form URL would
  // be an exfiltration channel (ADR 0004).
  if (!state.allowedUrls.has(call.args.url)) {
    return { error: 'fetch_page only accepts URLs returned by search_site.' }
  }

  post(port, { type: 'ASK_STEP', step: { kind: 'reading', url: call.args.url } })
  const raw = await extractTavily(tavilyApiKey, call.args.url)
  if (!raw) {
    return { error: "That page couldn't be read. Use the search snippets, or search again." }
  }
  state.usedWeb = true

  // A fetched page is a whole article and can outgrow the same tool-result budget the
  // tab's own page is capped at (FETCHED_PAGE_CHAR_LIMIT), so it is cut here exactly like
  // the tab page is, and the rest kept for search_page to reach (#7) instead of leaving
  // it out with no way back in.
  const fetched = truncate(raw, FETCHED_PAGE_CHAR_LIMIT)
  if (fetched.truncated) state.fetchedFullContent = raw
  // FETCH_NOTE_CUT is shown regardless of citeEnabled: unlike FETCH_NOTE, it is not only
  // about steering the model away from citing, it is the only place the model learns
  // this fetch was incomplete and search_page can reach the rest.
  const note = fetched.truncated ? FETCH_NOTE_CUT(fetched.charsOmitted) : citeEnabled ? FETCH_NOTE : undefined
  return { url: call.args.url, content: fetched.content, ...(note ? { note } : {}) }
}

// search_page: a keyword search of the whole page (#11, ADR 0006), for the part the prompt
// doesn't hold and, since the model can't find everything in a long head either, the part
// it does. Everything it returns is page text, so cite_page can check a quote from it;
// nothing about it is trusted to be an answer. An empty result is a result, not an
// error: the model is told to try other words or work with what it has.
//
// A cut fetch_page result takes priority over the tab page (#7): it is the most recent
// thing the model asked to read, and has no other way back into it. Documented scope
// limit, not solved: if both are cut in the same turn, the fetch wins for the rest of it.
// Unlike a tab-page passage, a fetched one is never pushed to passageTexts — cite_page
// never checks against fetched content (ADR 0005 stays scoped to the tab page), so a
// quote from one could never legitimately earn search-page credit either.
function searchWholePage({ port, page, pageSearchEnabled, fullContent, state }: ToolContext, query: string): unknown {
  if (state.fetchedFullContent !== undefined) {
    post(port, { type: 'ASK_STEP', step: { kind: 'scanning', query } })
    const passages = searchPage(state.fetchedFullContent, query, FETCHED_PAGE_CHAR_LIMIT)
    state.pageSearches++
    state.pagePassages += passages.length
    return { passages, note: passages.length ? PAGE_SEARCH_NOTE_FETCHED : PAGE_SEARCH_EMPTY_NOTE_FETCHED }
  }

  if (!pageSearchEnabled || fullContent === undefined) {
    state.problems.push('search_page is not available.')
    return { error: 'search_page is not available.' }
  }

  post(port, { type: 'ASK_STEP', step: { kind: 'scanning', query } })

  // The end of what the prompt holds is where the part it lacks begins: that part gets
  // slots of its own, so a head that says the word often can't fill the result.
  const passages = searchPage(fullContent, query, page.content.length)
  state.pageSearches++
  state.pagePassages += passages.length
  for (const { text } of passages) state.passageTexts.push(collapseWhitespace(text))
  return { passages, note: passages.length ? PAGE_SEARCH_NOTE : PAGE_SEARCH_EMPTY_NOTE }
}

// How many verified quotes were taken from a passage search_page returned this turn. A
// quote is stored whitespace-collapsed, as the passages are, so it is a plain substring.
function quotesFromSearch(state: LoopState): number {
  return [...state.verifiedQuotes].filter((quote) => state.passageTexts.some((text) => text.includes(quote))).length
}

// cite_page: checks each quote against the page text and remembers the ones found.
// A fabricated quote is a recoverable error, not a thrown loop, and the model is never
// the enforcement point (ADR 0005). With nothing verified the result is the error and
// the way out. Once anything has, the label has what it needs, so the result says to
// answer with what verified — including when some quotes were rejected: better the
// answer leaves out what it could not quote than a round is spent correcting it.
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
    // The panel disconnected. Nothing to report to, and the loop stops at the top
    // of the next round — so this is not an error worth propagating.
  }
}
