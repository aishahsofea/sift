import type { AgentTraceRound, TurnStats } from '../../shared/types'

// Undefined when no round reported the field, so "not reported" never reads as zero.
function sumReported(values: (number | undefined)[]): number | undefined {
  const reported = values.filter((value): value is number => value !== undefined)
  return reported.length ? reported.reduce((total, value) => total + value, 0) : undefined
}

export function summarizeTurn(rounds: readonly AgentTraceRound[], durationMs: number): TurnStats {
  const model = rounds.at(-1)?.model
  const promptTokens = sumReported(rounds.map((round) => round.usage?.promptTokens))
  const cachedTokens = sumReported(rounds.map((round) => round.usage?.cachedTokens))
  return {
    ...(model && model !== 'unknown' ? { model } : {}),
    durationMs,
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    toolRounds: rounds.filter((round) => round.toolCalls.length > 0).length,
  }
}
