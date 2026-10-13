import { describe, expect, it } from 'vitest'
import { describeStats, explainStats } from './statsLabel'

const NANO = 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B'

describe('describeStats', () => {
  it('shows every part it has', () => {
    expect(describeStats({ model: NANO, durationMs: 4200, promptTokens: 23_400, cachedTokens: 21_100, toolRounds: 2 })).toBe(
      'Nemotron 3 Nano · 4.2s · 23.4K prompt tokens (21.1K cached) · 2 tool rounds',
    )
  })

  it('uses the singular for one round', () => {
    expect(describeStats({ durationMs: 1000, toolRounds: 1 })).toBe('1.0s · 1 tool round')
  })

  it('drops tokens and rounds when nothing was reported or run', () => {
    expect(describeStats({ model: NANO, durationMs: 3000, toolRounds: 0 })).toBe('Nemotron 3 Nano · 3.0s')
  })

  it('drops cached tokens that arrive without a prompt count', () => {
    expect(describeStats({ durationMs: 3000, cachedTokens: 500, toolRounds: 0 })).toBe('3.0s')
  })

  it('shows a sub-second time in milliseconds, and small token counts whole', () => {
    expect(describeStats({ durationMs: 420, promptTokens: 850, toolRounds: 0 })).toBe('420ms · 850 prompt tokens')
  })

  it('falls back to the raw ID for an unknown model', () => {
    expect(describeStats({ model: 'acme/other-1', durationMs: 2000, toolRounds: 0 })).toBe('acme/other-1 · 2.0s')
  })
})

describe('explainStats', () => {
  it('carries the raw model ID and what the token figure adds up', () => {
    expect(explainStats({ model: NANO, durationMs: 1, promptTokens: 10, toolRounds: 0 })).toBe(
      `Model: ${NANO}. Prompt tokens add up every model call made for this answer.`,
    )
  })

  it('has nothing to say without a model or tokens', () => {
    expect(explainStats({ durationMs: 1, toolRounds: 0 })).toBeUndefined()
  })
})
