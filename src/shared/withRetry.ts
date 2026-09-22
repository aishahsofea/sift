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
    if (isRetry) throw error
    return attempt(url, init, true)
  }

  if (res.status >= 400 && res.status < 500) {
    throw new Error('Request failed — check your API key in Options.')
  }

  if (res.status >= 500 && !isRetry) {
    return attempt(url, init, true)
  }

  return res
}
