// One retry on network failure or 5xx, never 4xx: a 4xx means a bad or missing key and should surface.
export async function withRetry(url: string, init: RequestInit): Promise<Response> {
  return attempt(url, init, false)
}

async function attempt(url: string, init: RequestInit, isRetry: boolean): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (error) {
    // A caller's own cancellation isn't transient; retrying would double the wait.
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
