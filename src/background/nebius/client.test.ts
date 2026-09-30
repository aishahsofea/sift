import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NEBIUS_STREAM_IDLE_TIMEOUT_MS } from '../../shared/constants'
import { streamAgentTurn } from './client'

vi.mock('./modelDiscovery', () => ({ resolveNemotronModel: vi.fn().mockResolvedValue('test-model') }))

// A ReadableStream reader the test drives by hand: read() stays pending until push()
// or end() resolves it, and it rejects with the signal's abort reason the instant
// streamAgentTurn aborts — the same thing a real in-flight fetch body read would do.
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
    // Attached now, synchronously, so the promise is never briefly unhandled once the
    // timer advance below makes it reject.
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

    // 5 gaps of (idle window - 1s): none alone trips the timer, but their sum is
    // almost 2.5x the idle window — proves this is silence-based, not a flat cap.
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
