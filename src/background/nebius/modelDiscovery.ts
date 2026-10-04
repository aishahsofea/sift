import { NEBIUS_BASE_URL } from '../../shared/constants'

// Live-checked IDs in preference order: Nano first (ADR 0002), then Super; untested ones only as fallback.
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
