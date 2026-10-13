import type { TurnStats } from '../shared/types'

const MODEL_NAMES: Record<string, string> = {
  'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B': 'Nemotron 3 Nano',
  'nvidia/nemotron-3-super-120b-a12b': 'Nemotron 3 Super',
  'nvidia/Nemotron-3-Ultra-550b-a55b': 'Nemotron 3 Ultra',
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(count: number): string {
  return count < 1000 ? String(count) : `${(count / 1000).toFixed(1)}K`
}

// Quiet one-line cost of an answer; parts the turn didn't report are left out.
export function describeStats({ model, durationMs, promptTokens, cachedTokens, toolRounds }: TurnStats): string {
  const parts = [model ? (MODEL_NAMES[model] ?? model) : undefined, formatDuration(durationMs)]
  if (promptTokens !== undefined) {
    parts.push(`${formatTokens(promptTokens)} prompt tokens${cachedTokens !== undefined ? ` (${formatTokens(cachedTokens)} cached)` : ''}`)
  }
  if (toolRounds > 0) parts.push(`${toolRounds} tool ${toolRounds === 1 ? 'round' : 'rounds'}`)
  return parts.filter(Boolean).join(' · ')
}

// The hover text: the raw model ID, and what the token figure adds up.
export function explainStats({ model, promptTokens }: TurnStats): string | undefined {
  const sentences = [
    model ? `Model: ${model}.` : undefined,
    promptTokens !== undefined ? 'Prompt tokens add up every model call made for this answer.' : undefined,
  ].filter(Boolean)
  return sentences.length ? sentences.join(' ') : undefined
}
