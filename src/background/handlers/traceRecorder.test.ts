import { describe, expect, it } from 'vitest'
import { MIN_QUOTE_CHARS } from '../../shared/constants'
import {
  createTraceRecorder,
  finalizeTrace,
  fingerprintPrompt,
  recordRound,
  summarizeToolCall,
  type TraceRecorder,
} from './traceRecorder'

const timing = { durationMs: 100 }

describe('createTraceRecorder', () => {
  it('records only the question length with the content toggle off', () => {
    const recorder = createTraceRecorder({ tabId: 7, question: 'What does this page say?', contentEnabled: false })

    expect(recorder.question).toEqual({ length: 24 })
  })

  it('records the question text too with the content toggle on', () => {
    const recorder = createTraceRecorder({ tabId: 7, question: 'What does this page say?', contentEnabled: true })

    expect(recorder.question).toEqual({ length: 24, text: 'What does this page say?' })
  })

  it('starts with no rounds and every flag false', () => {
    const recorder = createTraceRecorder({ tabId: 7, question: 'q', contentEnabled: false })

    expect(recorder.rounds).toEqual([])
    expect(recorder.askedToQuote).toBe(false)
    expect(recorder.forcedNudgeSent).toBe(false)
    expect(recorder.forcedRetrySent).toBe(false)
  })

  it('gives each recorder its own id', () => {
    const a = createTraceRecorder({ tabId: 7, question: 'q', contentEnabled: false })
    const b = createTraceRecorder({ tabId: 7, question: 'q', contentEnabled: false })

    expect(a.id).not.toBe(b.id)
  })
})

describe('recordRound', () => {
  function recorder(contentEnabled: boolean): TraceRecorder {
    return createTraceRecorder({ tabId: 1, question: 'q', contentEnabled })
  }

  it('redacts reasoning and discardedAnswer to a bare length with the toggle off', () => {
    const rec = recorder(false)
    recordRound(rec, {
      index: 0,
      model: 'nemotron',
      timing,
      forced: false,
      reasoning: 'thinking it through',
      discardedAnswer: 'an answer that got thrown away',
      toolCalls: [],
    })

    expect(rec.rounds[0].reasoning).toEqual({ length: 'thinking it through'.length })
    expect(rec.rounds[0].discardedAnswer).toEqual({ length: 'an answer that got thrown away'.length })
  })

  it('keeps reasoning and discardedAnswer text with the toggle on', () => {
    const rec = recorder(true)
    recordRound(rec, {
      index: 0,
      model: 'nemotron',
      timing,
      forced: false,
      reasoning: 'thinking it through',
      discardedAnswer: 'an answer that got thrown away',
      toolCalls: [],
    })

    expect(rec.rounds[0].reasoning).toEqual({ length: 'thinking it through'.length, text: 'thinking it through' })
    expect(rec.rounds[0].discardedAnswer).toEqual({
      length: 'an answer that got thrown away'.length,
      text: 'an answer that got thrown away',
    })
  })

  it('leaves reasoning and discardedAnswer absent when the round had none, toggle on or off', () => {
    const rec = recorder(true)
    recordRound(rec, { index: 0, model: 'nemotron', timing, forced: false, toolCalls: [] })

    expect(rec.rounds[0].reasoning).toBeUndefined()
    expect(rec.rounds[0].discardedAnswer).toBeUndefined()
  })

  it('leaves usage undefined when the round reported none, never zeroing it', () => {
    const rec = recorder(false)
    recordRound(rec, { index: 0, model: 'nemotron', timing, forced: false, toolCalls: [] })

    expect(rec.rounds[0].usage).toBeUndefined()
  })

  it('carries usage, finishReason and forced through unchanged', () => {
    const rec = recorder(false)
    const usage = { promptTokens: 10, totalTokens: 12 }
    recordRound(rec, { index: 2, model: 'nemotron', usage, finishReason: 'stop', timing, forced: true, toolCalls: [] })

    expect(rec.rounds[0]).toMatchObject({ index: 2, model: 'nemotron', usage, finishReason: 'stop', forced: true })
  })

  it('appends rounds in call order', () => {
    const rec = recorder(false)
    recordRound(rec, { index: 0, model: 'nemotron', timing, forced: false, toolCalls: [] })
    recordRound(rec, { index: 1, model: 'nemotron', timing, forced: false, toolCalls: [] })

    expect(rec.rounds.map((round) => round.index)).toEqual([0, 1])
  })
})

describe('summarizeToolCall', () => {
  describe('cite_page', () => {
    it('summarizes every quote verified', () => {
      const args = { quotes: ['Thanks to the 1,200 beta testers'] }
      const result = { verified: ['Thanks to the 1,200 beta testers'], note: 'All of these are on the page.' }

      const call = summarizeToolCall('cite_page', args, result, false)

      expect(call.ok).toBe(true)
      expect(call.summary).toBe('1 quote, 1 verified')
    })

    it('reports a mix of verified and rejected-as-too-short quotes, matching the issue example', () => {
      const short = 'x'.repeat(MIN_QUOTE_CHARS - 1)
      const args = { quotes: ['Thanks to the 1,200 beta testers', 'The launch date', short] }
      const result = { verified: ['Thanks to the 1,200 beta testers', 'The launch date'], error: `quote too short: "${short}"` }

      const call = summarizeToolCall('cite_page', args, result, false)

      expect(call.summary).toBe('3 quotes, 2 verified, 1 rejected as too short')
    })

    it('reports a rejected-as-not-found quote independently of the clipped error string', () => {
      const invented = 'x'.repeat(500)
      const args = { quotes: [invented] }
      // The source error is clipped to 80 chars; the summary must not simply echo it.
      const result = { verified: [], error: `quote not found in page text: "${invented.slice(0, 80)}…". Copy each passage exactly...` }

      const call = summarizeToolCall('cite_page', args, result, false)

      expect(call.ok).toBe(false)
      expect(call.summary).toBe('1 quote, 0 verified, 1 rejected as not found')
    })

    it('reports both rejection reasons together when a call mixes them', () => {
      const tooShort = 'x'.repeat(MIN_QUOTE_CHARS - 1)
      const notFound = 'y'.repeat(50)
      const args = { quotes: [tooShort, notFound] }
      const result = { verified: [], error: 'rejected' }

      const call = summarizeToolCall('cite_page', args, result, false)

      expect(call.summary).toBe('2 quotes, 0 verified, 2 rejected (1 too short, 1 not found)')
    })

    it('is ok when at least one quote verified even if a note also carries a partial error', () => {
      const result = { verified: ['Thanks to the 1,200 beta testers'], error: 'quote too short: "Dana"', note: 'partial' }

      const call = summarizeToolCall('cite_page', { quotes: ['Thanks to the 1,200 beta testers', 'Dana'] }, result, false)

      expect(call.ok).toBe(true)
    })

    it('is not ok when cite_page was refused outright, with no quotes array to classify', () => {
      const call = summarizeToolCall('cite_page', { quotes: ['anything'] }, { error: 'cite_page is not available.' }, false)

      expect(call.ok).toBe(false)
      expect(call.summary).toBe('error: cite_page is not available.')
    })

    it('includes raw args and result only with the content toggle on', () => {
      const args = { quotes: ['Thanks to the 1,200 beta testers'] }
      const result = { verified: ['Thanks to the 1,200 beta testers'], note: 'done' }

      expect(summarizeToolCall('cite_page', args, result, false)).not.toHaveProperty('args')
      expect(summarizeToolCall('cite_page', args, result, false)).not.toHaveProperty('result')
      const withContent = summarizeToolCall('cite_page', args, result, true)
      expect(withContent.args).toEqual(args)
      expect(withContent.result).toEqual(result)
    })
  })

  describe('search_site', () => {
    it('counts results', () => {
      const call = summarizeToolCall('search_site', { query: 'q' }, { results: [{ url: 'a' }, { url: 'b' }] }, false)
      expect(call.ok).toBe(true)
      expect(call.summary).toBe('2 results found')
    })

    it('reports no results distinctly from an error', () => {
      const call = summarizeToolCall('search_site', { query: 'q' }, { results: [] }, false)
      expect(call.ok).toBe(true)
      expect(call.summary).toBe('no results found')
    })

    it('reports an error, e.g. a missing Tavily key', () => {
      const call = summarizeToolCall('search_site', { query: 'q' }, { error: 'Search is not configured.' }, false)
      expect(call.ok).toBe(false)
      expect(call.summary).toBe('error: Search is not configured.')
    })
  })

  describe('search_page', () => {
    it('counts passages', () => {
      const call = summarizeToolCall('search_page', { query: 'q' }, { passages: [{ text: 'a' }] }, false)
      expect(call.ok).toBe(true)
      expect(call.summary).toBe('1 passages found')
    })

    it('reports an empty result as no passages, not an error', () => {
      const call = summarizeToolCall('search_page', { query: 'q' }, { passages: [] }, false)
      expect(call.ok).toBe(true)
      expect(call.summary).toBe('no passages found')
    })

    it('reports search_page being unavailable as an error', () => {
      const call = summarizeToolCall('search_page', { query: 'q' }, { error: 'search_page is not available.' }, false)
      expect(call.ok).toBe(false)
      expect(call.summary).toBe('error: search_page is not available.')
    })
  })

  describe('fetch_page', () => {
    it('reports the fetched content length', () => {
      const call = summarizeToolCall('fetch_page', { url: 'https://x' }, { url: 'https://x', content: 'hello world' }, false)
      expect(call.ok).toBe(true)
      expect(call.summary).toBe(`fetched ${'hello world'.length} chars`)
    })

    it("reports a page that couldn't be read as an error", () => {
      const call = summarizeToolCall('fetch_page', { url: 'https://x' }, { error: "That page couldn't be read." }, false)
      expect(call.ok).toBe(false)
      expect(call.summary).toBe("error: That page couldn't be read.")
    })
  })

  describe('a malformed or unrecognized call', () => {
    it('is not ok and summarizes the parse error, with no args to classify', () => {
      const call = summarizeToolCall('cite_page', undefined, { error: 'Invalid tool call: missing "quotes" argument' }, false)
      expect(call.ok).toBe(false)
      expect(call.summary).toBe('error: Invalid tool call: missing "quotes" argument')
    })

    it('handles a name the loop has never seen', () => {
      const call = summarizeToolCall('made_up_tool', undefined, { error: 'Invalid tool call: unknown tool "made_up_tool"' }, false)
      expect(call.ok).toBe(false)
      expect(call.summary).toContain('unknown tool')
    })
  })
})

describe('finalizeTrace', () => {
  it('produces a done trace with the answer, source and sourceFacts set', () => {
    const recorder = createTraceRecorder({ tabId: 7, question: 'q', contentEnabled: false })
    recorder.page = { length: 500, truncated: false, charsOmitted: 0, extractionMethod: 'readability', searchable: false }
    recorder.toolsOffered = ['cite_page']
    recorder.promptHash = 'abc'
    recorder.toolsHash = 'def'
    recorder.askedToQuote = true

    const trace = finalizeTrace(recorder, {
      status: 'done',
      extensionVersion: '0.1.0',
      answer: 'The answer.',
      source: 'page',
      sourceFacts: { usedWeb: false, quoteVerified: true, pageTruncated: false, quotedSearchResult: false },
    })

    expect(trace.id).toBe(recorder.id)
    expect(trace.tabId).toBe(7)
    expect(trace.status).toBe('done')
    expect(trace.extensionVersion).toBe('0.1.0')
    expect(trace.answer).toEqual({ length: 'The answer.'.length })
    expect(trace.source).toBe('page')
    expect(trace.sourceFacts).toEqual({ usedWeb: false, quoteVerified: true, pageTruncated: false, quotedSearchResult: false })
    expect(trace.page).toEqual(recorder.page)
    expect(trace.toolsOffered).toEqual(['cite_page'])
    expect(trace.promptHash).toBe('abc')
    expect(trace.toolsHash).toBe('def')
    expect(trace.askedToQuote).toBe(true)
  })

  it('keeps the answer text too with the content toggle on', () => {
    const recorder = createTraceRecorder({ tabId: 7, question: 'q', contentEnabled: true })

    const trace = finalizeTrace(recorder, { status: 'done', extensionVersion: '0.1.0', answer: 'The answer.' })

    expect(trace.answer).toEqual({ length: 'The answer.'.length, text: 'The answer.' })
  })

  it('leaves answer, source, sourceFacts, page, toolsOffered and the hashes absent on an early error exit', () => {
    const recorder = createTraceRecorder({ tabId: 7, question: 'q', contentEnabled: false })

    const trace = finalizeTrace(recorder, { status: 'error', extensionVersion: '0.1.0' })

    expect(trace.answer).toBeUndefined()
    expect(trace.source).toBeUndefined()
    expect(trace.sourceFacts).toBeUndefined()
    expect(trace.page).toBeUndefined()
    expect(trace.toolsOffered).toBeUndefined()
    expect(trace.promptHash).toBeUndefined()
    expect(trace.toolsHash).toBeUndefined()
  })

  it('records a panel-closed trace carrying whatever rounds already ran', () => {
    const recorder = createTraceRecorder({ tabId: 7, question: 'q', contentEnabled: false })
    recordRound(recorder, { index: 0, model: 'nemotron', timing, forced: false, toolCalls: [] })

    const trace = finalizeTrace(recorder, { status: 'panel-closed', extensionVersion: '0.1.0' })

    expect(trace.status).toBe('panel-closed')
    expect(trace.rounds).toHaveLength(1)
  })

  it('stamps an endedAt no earlier than startedAt', () => {
    const recorder = createTraceRecorder({ tabId: 7, question: 'q', contentEnabled: false })

    const trace = finalizeTrace(recorder, { status: 'done', extensionVersion: '0.1.0' })

    expect(new Date(trace.endedAt).getTime()).toBeGreaterThanOrEqual(new Date(trace.startedAt).getTime())
  })
})

describe('fingerprintPrompt', () => {
  it('gives the same promptHash for two pages with identical fixed wording', () => {
    const tools = [{ type: 'function', function: { name: 'cite_page' } }]
    const a = fingerprintPrompt('Answer questions about example.com.\n\nPAGE:\nFirst page content', 'First page content', tools)
    const b = fingerprintPrompt('Answer questions about example.com.\n\nPAGE:\nSecond page content', 'Second page content', tools)

    expect(a.promptHash).toBe(b.promptHash)
  })

  it('gives a different promptHash when the fixed wording differs', () => {
    const tools = [{ type: 'function', function: { name: 'cite_page' } }]
    const a = fingerprintPrompt('Answer questions about example.com.\n\nPAGE:\nSame page content', 'Same page content', tools)
    const b = fingerprintPrompt('Answer questions about a-different-site.com.\n\nPAGE:\nSame page content', 'Same page content', tools)

    expect(a.promptHash).not.toBe(b.promptHash)
  })

  it('gives a different toolsHash when the tools on offer differ', () => {
    const prompt = 'Answer questions.\n\nPAGE:\ncontent'
    const a = fingerprintPrompt(prompt, 'content', [{ function: { name: 'cite_page' } }])
    const b = fingerprintPrompt(prompt, 'content', [{ function: { name: 'cite_page' } }, { function: { name: 'search_page' } }])

    expect(a.toolsHash).not.toBe(b.toolsHash)
  })

  it('is deterministic for the same inputs', () => {
    const prompt = 'Answer questions.\n\nPAGE:\ncontent'
    const a = fingerprintPrompt(prompt, 'content', ['t'])
    const b = fingerprintPrompt(prompt, 'content', ['t'])

    expect(a).toEqual(b)
  })
})
