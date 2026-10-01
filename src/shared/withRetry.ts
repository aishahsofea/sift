// Wraps a single fetch call: one retry on network failure or a 5xx response,
// never on 4xx — a 4xx from either API in this app means a bad or missing
// key, so it surfaces immediately rather than being retried into a slower
// failure.
export async function withRetry(url: string, init: RequestInit): Promise<Response> {
  return attempt(url, init, false)
}

async function attempt(url: string, init: RequestInit, isRetry: boolean): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (error) {
    // A caller's own cancellation is not a transient failure — retrying it would
    // silently double however long the caller was already waiting to give up.
    if (init.signal?.aborted) throw error
    if (isRetry) throw error
    return attempt(url, init, true)
  }

  // The demo proxy's own cap, not a bad key: say what happened and what to do (#39).
  if (res.status === 429 && res.headers.get('X-Sift-Demo-Limit')) {
    const body = (await res.json().catch(() => undefined)) as { message?: string } | undefined
    throw new Error(body?.message ?? 'The shared demo has hit its daily limit. Add your own API keys in Options.')
  }

  if (res.status >= 400 && res.status < 500) {
    throw new Error('Request failed — check your API key in Options.')
  }

  if (res.status >= 500 && !isRetry) {
    return attempt(url, init, true)
  }

  return res
}
