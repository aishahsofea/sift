import { MAX_TOOL_ROUNDS } from '../../shared/constants'
import type { AskPortMessage } from '../../shared/messages'
import type { ChatTurn, ExtractedPage } from '../../shared/types'
import { appendHistoryTurns, getExtractedPage, getHistory } from '../history/sessionHistory'
import { getApiKeys } from '../keys'
import { streamAgentTurn } from '../nebius/client'
import { assembleAgentMessages, type ChatMessage } from '../nebius/promptAssembly'
import { parseToolCall, type ParsedToolCall } from '../nebius/schema'
import { containsToolMarkup, FORCE_NUDGE, SEARCH_SITE, TOOLS } from '../nebius/tools'
import { extractTavily, searchTavily } from '../tavily/client'
import { scopeToDomain } from '../tavily/scopeToDomain'
import { deriveSource } from './answerSource'

// State the loop carries across rounds, scoped to this one question.
interface LoopState {
  /** URLs a search_site call returned this turn — the only URLs fetch_page accepts. */
  allowedUrls: Set<string>
  /** Whether a tool actually returned something, which is what "from the web" means. */
  usedWeb: boolean
}

export async function runAgentLoop(port: chrome.runtime.Port, tabId: number, question: string): Promise<void> {
  // The panel can close mid-loop (a search round takes seconds). Once it has, no
  // one is listening, so stop before starting another paid round.
  let panelGone = false
  port.onDisconnect.addListener(() => {
    panelGone = true
  })

  try {
    const { nebiusApiKey, tavilyApiKey } = await getApiKeys()
    if (!nebiusApiKey) {
      post(port, { type: 'ASK_ERROR', message: 'Add your Nebius API key in Options before asking questions.' })
      return
    }

    const page = await getExtractedPage(tabId)
    if (!page) {
      post(port, {
        type: 'ASK_ERROR',
        message: 'No page content available yet. Try reopening the side panel on this tab.',
      })
      return
    }

    // Without a Tavily key the tools can't run, so they aren't offered: the loop
    // degrades to a single page-grounded round instead of failing outright.
    const searchEnabled = Boolean(tavilyApiKey)
    const history = await getHistory(tabId)
    const messages = assembleAgentMessages(page, history, question, { searchEnabled })
    const state: LoopState = { allowedUrls: new Set(), usedWeb: false }

    for (let round = 1; ; round++) {
      if (panelGone) return
      // Past the cap the tools come off and a nudge goes on, for this request only
      // — the nudge is never written to history (ADR 0003).
      const forced = round > MAX_TOOL_ROUNDS
      const turnMessages: ChatMessage[] = forced ? [...messages, { role: 'user', content: FORCE_NUDGE }] : messages

      const { content, toolCalls } = await streamAgentTurn(nebiusApiKey, turnMessages, {
        tools: forced || !searchEnabled ? undefined : TOOLS,
        onContent: (delta) => post(port, { type: 'ASK_CHUNK', delta }),
      })

      if (!toolCalls.length) {
        await finish(port, tabId, question, content, state, page)
        return
      }

      if (forced) {
        throw new Error('The model kept searching instead of answering.')
      }

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

      for (const call of toolCalls) {
        // The key is re-checked rather than asserted: a tool call with no key to
        // run it becomes a tool-role error like any other, never a thrown loop.
        const output = tavilyApiKey
          ? await runTool(port, page.url, tavilyApiKey, state, parseToolCall(call))
          : { error: 'Search is not configured.' }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) })
      }
    }
  } catch (error) {
    console.error(`[Sift] agent loop failed for tab ${tabId}:`, error)
    post(port, {
      type: 'ASK_ERROR',
      message: error instanceof Error ? error.message : 'Something went wrong answering that.',
    })
  }
}

async function finish(
  port: chrome.runtime.Port,
  tabId: number,
  question: string,
  content: string,
  state: LoopState,
  page: ExtractedPage,
): Promise<void> {
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
  // output (ADR 0001) — and not from the absence of a tool call alone (ADR 0005).
  const source = deriveSource({ usedWeb: state.usedWeb, pageTruncated: page.truncated })

  // One object is both persisted and posted, so the panel shows live exactly what a
  // reload will read back from history.
  const turn: ChatTurn = {
    role: 'assistant',
    content: answer,
    source,
    ...(page.truncated ? { truncated: true, charsOmitted: page.charsOmitted } : {}),
  }

  await appendHistoryTurns(tabId, [{ role: 'user', content: question }, turn])
  post(port, { type: 'ASK_DONE', turn })
}

// Runs one validated tool call and returns whatever should go back as its result.
// Every failure path returns an error object rather than throwing: the model gets
// the message as the tool result and can correct itself on the next round.
async function runTool(
  port: chrome.runtime.Port,
  pageUrl: string,
  tavilyApiKey: string,
  state: LoopState,
  call: ParsedToolCall,
): Promise<unknown> {
  if (!call.ok) {
    return { error: call.error }
  }

  if (call.name === SEARCH_SITE) {
    const domain = scopeToDomain(pageUrl)
    post(port, { type: 'ASK_STEP', step: { kind: 'searching', domain, query: call.args.query } })

    const results = await searchTavily(tavilyApiKey, call.args.query, pageUrl)
    for (const result of results) state.allowedUrls.add(result.url)
    if (results.length) state.usedWeb = true
    return { results }
  }

  // fetch_page. The allowlist is enforced here, next to the loop state, and is
  // never a prompt instruction: page text is untrusted and a free-form URL would
  // be an exfiltration channel (ADR 0004).
  if (!state.allowedUrls.has(call.args.url)) {
    return { error: 'fetch_page only accepts URLs returned by search_site.' }
  }

  post(port, { type: 'ASK_STEP', step: { kind: 'reading', url: call.args.url } })
  const content = await extractTavily(tavilyApiKey, call.args.url)
  if (!content) {
    return { error: "That page couldn't be read. Use the search snippets, or search again." }
  }
  state.usedWeb = true
  return { url: call.args.url, content }
}

function post(port: chrome.runtime.Port, message: AskPortMessage): void {
  try {
    port.postMessage(message)
  } catch {
    // The panel disconnected. Nothing to report to, and the loop stops at the top
    // of the next round — so this is not an error worth propagating.
  }
}
