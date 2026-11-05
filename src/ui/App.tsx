import { TemplateStep } from './TemplateStep'

function ComingSoon({ id, title, text }: { id: string; title: string; text: string }) {
  return (
    <section aria-labelledby={id} className="pending">
      <h2 id={id}>{title}</h2>
      <p className="note">{text}</p>
    </section>
  )
}

export function App() {
  return (
    <main>
      <h1>Handwriting to Font</h1>
      <p>Turn your handwriting into a font you can install and use in Word.</p>
      <p className="note">Everything runs in your browser. Your handwriting never leaves your computer.</p>
      <TemplateStep />
      <ComingSoon id="step-upload" title="2. Upload your scans" text="Coming soon." />
      <ComingSoon id="step-review" title="3. Review your letters" text="Coming soon." />
      <ComingSoon id="step-preview" title="4. Preview and download your font" text="Coming soon." />
    </main>
  )
}
