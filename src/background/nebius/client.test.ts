import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NEBIUS_STREAM_IDLE_TIMEOUT_MS } from '../../shared/constants'
import { streamAgentTurn } from './client'

vi.mock('./modelDiscovery', () => ({ resolveNemotronModel: vi.fn().mockResolvedValue('test-model') }))

// A reader driven by hand: read() stays pending until push()/end() and rejects with the signal's abort reason, like a real body read.
function fakeBody(signal: AbortSignal) {
  let pending: { resolve: (r: { done: boolean; value?: Uint8Array }) => void; reject: (e: unknown) => void } | undefined

  signal.addEventListener('abort', () => {
    pending?.reject(signal.reason)
    pending = undefined
  })

  return {
    getReader: () => ({
      read: () =>
        new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
          if (signal.aborted) return reject(signal.reason)
          pending = { resolve, reject }
        }),
    }),
    push(chunk: string) {
      pending?.resolve({ done: false, value: new TextEncoder().encode(chunk) })
      pending = undefined
    },
    end() {
      pending?.resolve({ done: true, value: undefined })
      pending = undefined
    },
  }
}

function stubStreamingFetch() {
  let body: ReturnType<typeof fakeBody>
  const fetchMock = vi.fn((_url: string, init: RequestInit) => {
    body = fakeBody(init.signal as AbortSignal)
    return Promise.resolve({ ok: true, status: 200, body })
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    push: (chunk: string) => body.push(chunk),
    end: () => body.end(),
  }
}

const sseLine = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
// The terminal chunk stream_options.include_usage adds: choices is empty, usage is populated.
const sseUsageLine = (usage: unknown) => `data: ${JSON.stringify({ choices: [], usage })}\n\n`
const sseFinishLine = (finish_reason: string) => `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason }] })}\n\n`
const sseReasoningLine = (reasoning: string, field: 'reasoning' | 'reasoning_content' = 'reasoning') =>
  `data: ${JSON.stringify({ choices: [{ delta: { [field]: reasoning } }] })}\n\n`

describe('streamAgentTurn idle timeout (#28)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('aborts and rejects with the stall message once the stream goes silent past the idle window', async () => {
    const { push } = stubStreamingFetch()

    const promise = streamAgentTurn('key', [], { onContent: vi.fn() })
    // Attached synchronously so the rejection is never briefly unhandled.
    const rejection = expect(promise).rejects.toThrow(/no data for 30s/)
    await vi.advanceTimersByTimeAsync(0)
    push(sseLine('Hello'))
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(NEBIUS_STREAM_IDLE_TIMEOUT_MS)

    await rejection
  })

  it('resolves normally when each chunk arrives just under the idle window, even though the total stream runs well past it', async () => {
    const { push, end } = stubStreamingFetch()

    const promise = streamAgentTurn('key', [], { onContent: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)

    // 5 gaps of (idle window - 1s) sum to ~2.5x the window: shows the timeout is silence-based, not a flat cap.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(NEBIUS_STREAM_IDLE_TIMEOUT_MS - 1000)
      push(sseLine(`chunk${i} `))
      await vi.advanceTimersByTimeAsync(0)
    }
    end()

    const result = await promise
    expect(result.content).toBe('chunk0 chunk1 chunk2 chunk3 chunk4 ')
  })

  it('leaves a normal fast stream unaffected', async () => {
    const { push, end } = stubStreamingFetch()
    const onContent = vi.fn()

    const promise = streamAgentTurn('key', [], { onContent })
    await vi.advanceTimersByTimeAsync(0)
    push(sseLine('Hi there'))
    await vi.advanceTimersByTimeAsync(0)
    end()

    const result = await promise
    expect(result.content).toBe('Hi there')
    expect(onContent).toHaveBeenCalledWith('Hi there')
  })
})

describe('streamAgentTurn per-round metadata (#18)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('captures usage from the include_usage terminal chunk, whose choices array is empty', async () => {
    const { push, end } = stubStreamingFetch()

    const promise = streamAgentTurn('key', [], { onContent: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    push(sseLine('Hi'))
    await vi.advanceTimersByTimeAsync(0)
    push(sseUsageLine({ prompt_tokens: 120, completion_tokens: 40, total_tokens: 160, prompt_tokens_details: { cached_tokens: 96 } }))
    await vi.advanceTimersByTimeAsync(0)
    end()

    const result = await promise
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 40, totalTokens: 160, cachedTokens: 96 })
  })

  it('leaves usage undefined when Nebius never sends a usage chunk', async () => {
    const { push, end } = stubStreamingFetch()

    const promise = streamAgentTurn('key', [], { onContent: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    push(sseLine('Hi'))
    await vi.advanceTimersByTimeAsync(0)
    end()

    const result = await promise
    expect(result.usage).toBeUndefined()
  })

  it('captures the finish_reason carried on a choices chunk', async () => {
    const { push, end } = stubStreamingFetch()

    const promise = streamAgentTurn('key', [], { onContent: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    push(sseLine('Hi'))
    await vi.advanceTimersByTimeAsync(0)
    push(sseFinishLine('stop'))
    await vi.advanceTimersByTimeAsync(0)
    end()

    const result = await promise
    expect(result.finishReason).toBe('stop')
  })

  it.each(['reasoning', 'reasoning_content'] as const)(
    'accumulates chain-of-thought text under `%s` without ever passing it to onContent',
    async (field) => {
      const { push, end } = stubStreamingFetch()
      const onContent = vi.fn()

      const promise = streamAgentTurn('key', [], { onContent })
      await vi.advanceTimersByTimeAsync(0)
      push(sseReasoningLine('Thinking it through...', field))
      await vi.advanceTimersByTimeAsync(0)
      push(sseLine('Answer'))
      await vi.advanceTimersByTimeAsync(0)
      end()

      const result = await promise
      expect(result.reasoning).toBe('Thinking it through...')
      expect(onContent).toHaveBeenCalledTimes(1)
      expect(onContent).toHaveBeenCalledWith('Answer')
    },
  )

  it('returns the resolved model id and a timing summary alongside content', async () => {
    const { push, end } = stubStreamingFetch()

    const promise = streamAgentTurn('key', [], { onContent: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    push(sseLine('Hi'))
    await vi.advanceTimersByTimeAsync(0)
    end()

    const result = await promise
    expect(result.model).toBe('test-model')
    expect(result.timing?.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.timing?.firstByteMs).toBeGreaterThanOrEqual(0)
  })
})
