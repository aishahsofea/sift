import { NEBIUS_BASE_URL } from '../../shared/constants'

// Reimplements the discover-then-prefer pattern from scripts/test-nebius.mjs
// (not imported — that script runs under plain process.env, this runs in the
// service worker under chrome.storage.local).
//
// Only IDs checked against a live GET /v1/models go in here, in preference
// order. Nano first per ADR 0002; Super second because the same spike showed
// it correct, just slower and uncached. The account's other two Nemotrons
// (Nemotron-3_5-Lightning, Nemotron-3-Ultra-550b-a55b) are untested for the
// agent loop, so they stay out and are reached only via the fallback below.
const NEMOTRON_CANDIDATES = [
  'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
  'nvidia/nemotron-3-super-120b-a12b',
]

// Cached for the service worker's lifetime — cheap to keep, self-heals on restart.
let cachedModelId: string | undefined

export async function resolveNemotronModel(apiKey: string, baseUrl = NEBIUS_BASE_URL): Promise<string> {
  if (cachedModelId) return cachedModelId

  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    throw new Error(`GET /models failed: ${res.status} ${await res.text()}`)
  }

  const body = (await res.json()) as { data: { id: string }[] }
  const allModels = body.data.map((m) => m.id)
  const nemotronModels = allModels.filter((id) => /nemotron/i.test(id))
  const resolved = NEMOTRON_CANDIDATES.find((id) => allModels.includes(id)) ?? nemotronModels[0]

  if (!resolved) {
    throw new Error('No Nemotron model available on this Nebius account/region.')
  }

  cachedModelId = resolved
  return resolved
}
