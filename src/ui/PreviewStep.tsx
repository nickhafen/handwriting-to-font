import { useEffect, useRef, useState } from 'react'
import { buildSuffix } from '../core/font/build'
import { validateFont, type FontReport } from '../core/font/validate'
import { buildProjectFont, DEFAULT_FONT_SETTINGS, glyphInputs, type FontSettings, type ReviewGlyph } from '../core/project'
import { CHARSET } from '../core/template/charset'
import { downloadBlob, loadPreviewFont, unloadPreviewFont, type PreviewFace } from './fontFace'

const SAMPLE_TEXT = `The quick brown fox jumps over the lazy dog.
PACK MY BOX WITH FIVE DOZEN LIQUOR JUGS!
0123456789  “Quotes” and ‘apostrophes’ aren’t hard — really… (yes) [ok] {fine}
@ # $ % & * + = < > ^ _ ~ | \\ / § • \``

const EXPECTED = [' ', ...CHARSET.map((c) => c.char)]

interface PreviewState {
  face: PreviewFace | null
  report: FontReport | null
  error: string | null
}

interface Props {
  glyphs: ReviewGlyph[]
}

export function PreviewStep({ glyphs }: Props) {
  const [settings, setSettings] = useState<FontSettings>(DEFAULT_FONT_SETTINGS)
  const [text, setText] = useState(SAMPLE_TEXT)
  const [size, setSize] = useState(48)
  const [preview, setPreview] = useState<PreviewState>({ face: null, report: null, error: null })
  const [downloaded, setDownloaded] = useState<string | null>(null)
  const faceRef = useRef<PreviewFace | null>(null)
  const glyphCount = glyphInputs(glyphs).length

  // Rebuild the preview font (debounced) whenever the glyphs or spacing change.
  useEffect(() => {
    if (glyphCount === 0) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const built = buildProjectFont(glyphs, settings)
        const report = validateFont(built.buffer, EXPECTED)
        let face: PreviewFace | null = null
        let error: string | null = null
        try {
          face = await loadPreviewFont(built.buffer)
        } catch (e) {
          error = `Your browser rejected the font: ${e}`
        }
        if (cancelled) {
          unloadPreviewFont(face)
          return
        }
        unloadPreviewFont(faceRef.current)
        faceRef.current = face
        setPreview({ face, report, error })
      } catch (e) {
        if (!cancelled) setPreview({ face: null, report: null, error: `Couldn't build the font: ${e}` })
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [glyphs, glyphCount, settings.letterSpacing, settings.wordSpacing])

  useEffect(() => () => unloadPreviewFont(faceRef.current), [])

  function onDownload() {
    const suffix = settings.addBuildSuffix ? buildSuffix() : undefined
    const built = buildProjectFont(glyphs, settings, suffix)
    const report = validateFont(built.buffer, EXPECTED)
    if (!report.ok) {
      setPreview((p) => ({ ...p, report, error: 'The font failed its checks, so it was not downloaded.' }))
      return
    }
    const fileName = `${built.familyName.replace(/[^A-Za-z0-9]+/g, '')}-Regular.otf`
    downloadBlob(built.buffer, fileName, 'font/otf')
    setDownloaded(`${fileName} (font name “${built.familyName}”)`)
  }

  if (glyphCount === 0) {
    return (
      <section aria-labelledby="step-preview" className="pending">
        <h2 id="step-preview">4. Preview and download your font</h2>
        <p className="note">Upload your scans to preview your font here.</p>
      </section>
    )
  }

  const r = preview.report
  const set = (patch: Partial<FontSettings>) => setSettings((s) => ({ ...s, ...patch }))

  return (
    <section aria-labelledby="step-preview">
      <h2 id="step-preview">4. Preview and download your font</h2>

      <div className="controls">
        <label>
          Text size <output>{size}px</output>
          <input type="range" min={16} max={120} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <label>
          Letter spacing <output>{settings.letterSpacing}</output>
          <input
            type="range"
            min={-40}
            max={120}
            step={5}
            value={settings.letterSpacing}
            onChange={(e) => set({ letterSpacing: Number(e.target.value) })}
          />
        </label>
        <label>
          Word spacing <output>{settings.wordSpacing}</output>
          <input
            type="range"
            min={100}
            max={600}
            step={10}
            value={settings.wordSpacing}
            onChange={(e) => set({ wordSpacing: Number(e.target.value) })}
          />
        </label>
      </div>

      <label className="block">
        Preview text
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {preview.face ? (
        <div
          className="font-preview"
          data-testid="font-preview"
          style={{ fontFamily: `'${preview.face.family}', sans-serif`, fontSize: `${size}px` }}
        >
          {text}
        </div>
      ) : (
        !preview.error && <p className="note">Building your font…</p>
      )}

      {r && (
        <ul className="checks" data-testid="font-checks">
          <li className={r.missing.length ? 'warn' : 'good'}>
            {EXPECTED.length - r.missing.length} of {EXPECTED.length} characters in the font
            {r.missing.length > 0 && <> (missing: {r.missing.map((c) => (c === ' ' ? 'space' : c)).join(' ')})</>}
          </li>
          <li className={r.errors.length ? 'bad' : 'good'}>
            {r.errors.length ? r.errors.join(' ') : 'Line height covers every letter, so Windows won’t clip tails or tall letters'}
          </li>
          <li className={r.badWinding.length ? 'bad' : 'good'}>
            {r.badWinding.length ? `Outline direction problems: ${r.badWinding.join(', ')}` : 'Letter holes (o, e, a, 8…) are set up correctly'}
          </li>
          <li className={preview.face ? 'good' : 'bad'}>
            {preview.face ? 'Your browser accepted the font' : 'Your browser rejected the font'}
          </li>
        </ul>
      )}
      {preview.error && (
        <p role="alert" className="bad">
          {preview.error}
        </p>
      )}

      <div className="row download-row">
        <label>
          Font name <input value={settings.familyName} onChange={(e) => set({ familyName: e.target.value })} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.addBuildSuffix}
            onChange={(e) => set({ addBuildSuffix: e.target.checked })}
          />{' '}
          Add a build code to the name
        </label>
        <button onClick={onDownload} disabled={!preview.report}>
          Download OTF
        </button>
      </div>
      <p className="note">
        The build code (e.g. “My Handwriting {buildSuffix()}”) changes each time, so Windows never shows an older
        installed copy. To install: open the downloaded .otf file and click Install, then restart Word.
      </p>
      {downloaded && (
        <p className="good" role="status" data-testid="downloaded">
          Downloaded {downloaded}.
        </p>
      )}
    </section>
  )
}
