import { FontCheck } from './FontCheck'
import { PotraceCheck } from './PotraceCheck'

export function App() {
  return (
    <main>
      <h1>Handwriting to Font — Milestone 0 risk check</h1>
      <p className="note">Everything runs in your browser. Your handwriting never leaves your computer.</p>
      <FontCheck />
      <PotraceCheck />
    </main>
  )
}
