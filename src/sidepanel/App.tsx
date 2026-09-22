import { UnreadablePageState } from './components/UnreadablePageState'
import { useActiveTab } from './hooks/useActiveTab'

export default function App() {
  const { status } = useActiveTab()

  return (
    <main>
      <h1>Sift</h1>
      {status.state === 'loading' && <p>Reading page…</p>}
      {status.state === 'unreadable' && (
        <UnreadablePageState reason={status.reason} message={status.message} />
      )}
      {status.state === 'ready' && <p>Loaded: {status.page.title}</p>}
    </main>
  )
}
