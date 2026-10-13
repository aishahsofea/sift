import { describe, expect, it } from 'vitest'
import type { AgentTraceRound, TokenUsage } from '../../shared/types'
import { summarizeTurn } from './turnStats'

const round = (usage?: TokenUsage, extra: Partial<AgentTraceRound> = {}): AgentTraceRound => ({
  index: 0,
  model: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
  usage,
  timing: { durationMs: 100 },
  forced: false,
  toolCalls: [],
  ...extra,
})
const withTool = (usage?: TokenUsage) => round(usage, { toolCalls: [{ name: 'search_site', ok: true, summary: '' }] })

describe('summarizeTurn', () => {
  it('leaves token totals out when no round reported usage', () => {
    expect(summarizeTurn([round(), round()], 900)).toEqual({
      model: 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B',
      durationMs: 900,
      toolRounds: 0,
    })
  })

  it('sums the rounds that reported, skipping those that did not', () => {
    const stats = summarizeTurn([withTool({ promptTokens: 1000, cachedTokens: 800 }), round(), round({ promptTokens: 1500, cachedTokens: 0 })], 1)
    expect(stats.promptTokens).toBe(2500)
    expect(stats.cachedTokens).toBe(800)
  })

  it('keeps cached tokens when prompt tokens were not reported', () => {
    const stats = summarizeTurn([round({ cachedTokens: 50 })], 1)
    expect(stats.cachedTokens).toBe(50)
    expect(stats).not.toHaveProperty('promptTokens')
  })

  it('counts rounds with tool calls, not rounds', () => {
    expect(summarizeTurn([withTool(), withTool(), round()], 1).toolRounds).toBe(2)
    expect(summarizeTurn([round()], 1).toolRounds).toBe(0)
  })

  it('counts a forced round, and takes the model from the last round', () => {
    const stats = summarizeTurn([withTool({ promptTokens: 10 }), round({ promptTokens: 20 }, { forced: true, model: 'other' })], 1)
    expect(stats.promptTokens).toBe(30)
    expect(stats.model).toBe('other')
  })

  it('omits an unknown model and handles no rounds', () => {
    expect(summarizeTurn([round(undefined, { model: 'unknown' })], 5)).toEqual({ durationMs: 5, toolRounds: 0 })
    expect(summarizeTurn([], 5)).toEqual({ durationMs: 5, toolRounds: 0 })
  })
})
