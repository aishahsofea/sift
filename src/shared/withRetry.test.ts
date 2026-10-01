import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withRetry } from './withRetry'

function stubFetch(...responses: (Response | Error)[]) {
  const fetchMock = vi.fn()
  for (const r of responses) {
    if (r instanceof Error) fetchMock.mockRejectedValueOnce(r)
    else fetchMock.mockResolvedValueOnce(r)
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const ok = () => new Response(null, { status: 200 })
const serverError = () => new Response(null, { status: 500 })
const clientError = () => new Response(null, { status: 401 })

describe('withRetry', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries once on a thrown network error', async () => {
    const fetchMock = stubFetch(new TypeError('network down'), ok())

    const res = await withRetry('https://example.test', {})

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries once on a 5xx response', async () => {
    const fetchMock = stubFetch(serverError(), ok())

    const res = await withRetry('https://example.test', {})

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 4xx response', async () => {
    const fetchMock = stubFetch(clientError())

    await expect(withRetry('https://example.test', {})).rejects.toThrow(/check your API key/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("surfaces the demo proxy's cap as its own message, not a key error", async () => {
    const limited = new Response(JSON.stringify({ message: 'Daily limit reached.' }), { status: 429, headers: { 'X-Sift-Demo-Limit': 'global' } })
    const fetchMock = stubFetch(limited)

    await expect(withRetry('https://example.test', {})).rejects.toThrow('Daily limit reached.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats a 429 without the demo header as a plain 4xx', async () => {
    stubFetch(new Response(null, { status: 429 }))

    await expect(withRetry('https://example.test', {})).rejects.toThrow(/check your API key/)
  })

  it('does not retry a fetch that rejects because its own signal was aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    const fetchMock = stubFetch(abortError)

    await expect(withRetry('https://example.test', { signal: controller.signal })).rejects.toThrow(abortError.message)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
