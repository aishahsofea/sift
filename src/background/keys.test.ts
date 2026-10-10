import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../shared/constants', () => ({ DEMO_PROXY_URL: 'https://proxy.test' }))

const { getApiKeys } = await import('./keys')

function stubStorage(initial: Record<string, unknown>) {
  const data = { ...initial }
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string | string[]) => Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, data[k]])),
        set: async (items: Record<string, unknown>) => void Object.assign(data, items),
      },
    },
  })
  return data
}

describe('getApiKeys with a demo proxy built in', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('uses a stable install ID against the proxy when no keys are saved', async () => {
    const data = stubStorage({})

    const first = await getApiKeys()
    const second = await getApiKeys()

    expect(first.nebiusApiKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.tavilyApiKey).toBe(first.nebiusApiKey)
    expect(first.nebiusBaseUrl).toBe('https://proxy.test/nebius')
    expect(first.tavilyBaseUrl).toBe('https://proxy.test/tavily')
    expect(second.nebiusApiKey).toBe(first.nebiusApiKey)
    expect(data.installId).toBe(first.nebiusApiKey)
  })

  it('keeps a saved key direct and falls back only for the missing one', async () => {
    stubStorage({ nebiusApiKey: 'real-nebius' })

    const keys = await getApiKeys()

    expect(keys.nebiusApiKey).toBe('real-nebius')
    expect(keys.nebiusBaseUrl).toBeUndefined()
    expect(keys.tavilyBaseUrl).toBe('https://proxy.test/tavily')
  })

  it('touches no proxy when both keys are saved', async () => {
    stubStorage({ nebiusApiKey: 'a', tavilyApiKey: 'b' })

    expect(await getApiKeys()).toEqual({ nebiusApiKey: 'a', tavilyApiKey: 'b', deepModel: false })
  })

  it('honours the deep-model setting with a saved Nebius key', async () => {
    stubStorage({ nebiusApiKey: 'a', tavilyApiKey: 'b', deepModelEnabled: true })

    expect((await getApiKeys()).deepModel).toBe(true)
  })

  it('ignores the deep-model setting on the demo proxy, whose caps assume Nano', async () => {
    stubStorage({ deepModelEnabled: true })

    expect((await getApiKeys()).deepModel).toBe(false)
  })
})
