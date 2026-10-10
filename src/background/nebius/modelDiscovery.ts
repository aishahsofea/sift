import { NEBIUS_BASE_URL } from '../../shared/constants'

export type ModelTier = 'routine' | 'deep'

// Live-checked IDs in preference order: Nano first (ADR 0002), then Super; untested ones only as fallback.
const ROUTINE_CANDIDATES = [
  'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
  'nvidia/nemotron-3-super-120b-a12b',
]
const DEEP_CANDIDATES = ['nvidia/Nemotron-3-Ultra-550b-a55b']

// Cached per tier for the service worker's lifetime — cheap to keep, self-heals on restart.
const cachedModelIds = new Map<ModelTier, string>()

// Pins the model for evals; skips discovery, so the ID isn't checked against /models.
export function pinNemotronModel(id: string): void {
  cachedModelIds.set('routine', id)
  cachedModelIds.set('deep', id)
}

export async function resolveNemotronModel(apiKey: string, baseUrl = NEBIUS_BASE_URL, tier: ModelTier = 'routine'): Promise<string> {
  const cached = cachedModelIds.get(tier)
  if (cached) return cached

  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    throw new Error(`GET /models failed: ${res.status} ${await res.text()}`)
  }

  const body = (await res.json()) as { data: { id: string }[] }
  const allModels = body.data.map((m) => m.id)
  const nemotronModels = allModels.filter((id) => /nemotron/i.test(id))
  const candidates = tier === 'deep' ? [...DEEP_CANDIDATES, ...ROUTINE_CANDIDATES] : ROUTINE_CANDIDATES
  const resolved = candidates.find((id) => allModels.includes(id)) ?? nemotronModels[0]

  if (!resolved) {
    throw new Error('No Nemotron model available on this Nebius account/region.')
  }

  cachedModelIds.set(tier, resolved)
  return resolved
}
