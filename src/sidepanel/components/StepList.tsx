import type { AgentStep } from '../../shared/types'
import { describeStepDone } from '../stepLabel'

export function StepList({ steps }: { steps: AgentStep[] }) {
  return (
    <details className="message-steps">
      <summary>{steps.length === 1 ? '1 step' : `${steps.length} steps`}</summary>
      <ol>
        {steps.map((step, i) => (
          <li key={i}>{describeStepDone(step)}</li>
        ))}
      </ol>
    </details>
  )
}
