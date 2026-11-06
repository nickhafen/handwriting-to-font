import { PreviewStep } from './PreviewStep'
import { ReviewStep } from './ReviewStep'
import { TemplateStep } from './TemplateStep'
import { UploadStep } from './UploadStep'
import { useProject } from './useProject'

export function App() {
  const project = useProject()

  return (
    <main>
      <h1>Handwriting to Font</h1>
      <p>Turn your handwriting into a font you can install and use in Word.</p>
      <p className="note">Everything runs in your browser. Your handwriting never leaves your computer.</p>
      <TemplateStep />
      <UploadStep uploads={project.uploads} onFiles={project.addFiles} onPickPage={project.pickPage} />
      <ReviewStep
        glyphs={project.glyphs}
        adjust={project.adjust}
        onAdjust={project.setAdjust}
        overrides={project.overrides}
        onOverride={project.setOverride}
        busy={project.busy > 0}
      />
      <PreviewStep glyphs={project.glyphs} />
      <footer className="site-footer">
        <a href="https://github.com/nickhafen/handwriting-to-font">Source code</a> · App code: MIT License · Includes
        Potrace (GPL-2.0), so the app as a whole is distributed under GPL-2.0.{' '}
        <a href="https://github.com/nickhafen/handwriting-to-font/blob/main/THIRD_PARTY_NOTICES.md">Licenses</a>
      </footer>
    </main>
  )
}
