import type { AgentTrace, TracedText } from '../shared/types'

interface RecentRunsProps {
  traces: AgentTrace[]
  onRefresh: () => void
}

// Text is present only when the content toggle was on for that run; otherwise just its length.
function shown(value: TracedText | undefined): string {
  if (!value) return '—'
  return value.text ?? `${value.length} chars (content not recorded)`
}

export function RecentRuns({ traces, onRefresh }: RecentRunsProps) {
  const newestFirst = [...traces].reverse()

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>
        Recent runs <button onClick={onRefresh}>Refresh</button>
      </h2>
      {newestFirst.length === 0 && <p>No runs recorded yet.</p>}
      {newestFirst.map((trace) => (
        <details
          key={trace.id}
          data-status={trace.status}
          style={{ borderLeft: `3px solid ${trace.status === 'done' ? '#2a9d4b' : '#d33'}`, paddingLeft: '0.5rem', marginBottom: '0.5rem' }}
        >
          <summary>
            {new Date(trace.startedAt).toLocaleString()} · {trace.status} · {trace.source ?? 'no answer'} · {trace.rounds.length} rounds
            {trace.status !== 'done' && <strong> ⚠</strong>}
          </summary>
          <p>Question: {shown(trace.question)}</p>
          <p>Answer: {shown(trace.answer)}</p>
          <ol>
            {trace.rounds.map((round) => (
              <li key={round.index}>
                {round.model}
                {round.forced ? ' (forced)' : ''} · {round.timing.durationMs}ms
                {round.usage?.totalTokens !== undefined ? ` · ${round.usage.totalTokens} tokens` : ''}
                {round.toolCalls.map((call, i) => (
                  <div key={i}>
                    {call.ok ? '✓' : '✗'} {call.name}: {call.summary}
                  </div>
                ))}
                {round.discardedAnswer && <div>Discarded answer: {shown(round.discardedAnswer)}</div>}
              </li>
            ))}
          </ol>
          <button onClick={() => navigator.clipboard.writeText(JSON.stringify(trace, null, 2))}>Copy JSON</button>
        </details>
      ))}
    </section>
  )
}
