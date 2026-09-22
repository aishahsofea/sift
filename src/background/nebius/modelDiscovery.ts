import { NEBIUS_BASE_URL } from '../../shared/constants'

// Reimplements the discover-then-prefer pattern from scripts/test-nebius.mjs
// (not imported — that script runs under plain process.env, this runs in the
// service worker under chrome.storage.local). Preferred smallest/cheapest-first
// Nemotron chat models, in order, verified against the real /models list.
const NEMOTRON_CANDIDATES = [
  'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
  'nvidia/Nemotron-3-Nano-30B-A3B',
  'nvidia/Nemotron-Nano-V2-12b',
  'nvidia/Nemotron-3-Nano-Omni',
  'nvidia/Llama-3_1-Nemotron-Ultra-253B-v1',
]

// Cached for the service worker's lifetime — cheap to keep, self-heals on restart.
let cachedModelId: string | undefined

export async function resolveNemotronModel(apiKey: string): Promise<string> {
  if (cachedModelId) return cachedModelId

  const res = await fetch(`${NEBIUS_BASE_URL}/models`, {
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
