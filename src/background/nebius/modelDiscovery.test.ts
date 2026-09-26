import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// resolveNemotronModel caches for the service worker's lifetime, so every test
// needs a fresh module instance.
async function freshResolve() {
  vi.resetModules()
  const mod = await import('./modelDiscovery')
  return mod.resolveNemotronModel
}

function stubModels(ids: string[]) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: ids.map((id) => ({ id })) }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const ACCOUNT_MODELS = [
  'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
  'nvidia/Nemotron-3_5-Lightning',
  'nvidia/Nemotron-3-Ultra-550b-a55b',
  'nvidia/nemotron-3-super-120b-a12b',
  'meta-llama/Llama-3.3-70B-Instruct',
]

describe('resolveNemotronModel', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('picks Nano when the account exposes it', async () => {
    stubModels(ACCOUNT_MODELS)
    const resolve = await freshResolve()
    expect(await resolve('key')).toBe('nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B')
  })

  it('prefers the next candidate when Nano is gone', async () => {
    stubModels(ACCOUNT_MODELS.filter((id) => !id.includes('Nano')))
    const resolve = await freshResolve()
    expect(await resolve('key')).toBe('nvidia/nemotron-3-super-120b-a12b')
  })

  it('falls back to the first Nemotron match when no candidate is listed', async () => {
    stubModels(['nvidia/Nemotron-3_5-Lightning', 'meta-llama/Llama-3.3-70B-Instruct'])
    const resolve = await freshResolve()
    expect(await resolve('key')).toBe('nvidia/Nemotron-3_5-Lightning')
  })

  it('throws when the account has no Nemotron model at all', async () => {
    stubModels(['meta-llama/Llama-3.3-70B-Instruct'])
    const resolve = await freshResolve()
    await expect(resolve('key')).rejects.toThrow(/No Nemotron model available/)
  })

  it('hits /models once and reuses the cached ID', async () => {
    const fetchMock = stubModels(ACCOUNT_MODELS)
    const resolve = await freshResolve()
    await resolve('key')
    await resolve('key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
