import { useEffect, useRef, useState } from 'react'
import { buildSuffix } from '../core/font/build'
import { validateFont, type FontReport } from '../core/font/validate'
import {
  buildProjectFont,
  DEFAULT_FONT_SETTINGS,
  usableCount,
  type FontSettings,
  type GenerateSettings,
  type GlyphsByStyle,
} from '../core/project'
import { CHARSET } from '../core/template/charset'
import { STYLES, type StyleId } from '../core/template/styles'
import { downloadBlob, loadPreviewFont, unloadPreviewFont, type PreviewFace } from './fontFace'

const SAMPLE_TEXT = `The quick brown fox jumps over the lazy dog.
PACK MY BOX WITH FIVE DOZEN LIQUOR JUGS!
0123456789  “Quotes” and ‘apostrophes’ aren’t hard — really… (yes) [ok] {fine}
@ # $ % & * + = < > ^ _ ~ | \\ / § • \``

const EXPECTED = [' ', ...CHARSET.map((c) => c.char)]

/** Characters on the template that most keyboards can't type directly. */
const INSERTABLE: { char: string; label: string }[] = [
  { char: '–', label: 'en dash' },
  { char: '—', label: 'em dash' },
  { char: '§', label: 'section sign' },
  { char: '•', label: 'bullet' },
  { char: '…', label: 'ellipsis' },
  { char: '‘', label: 'left single quote' },
  { char: '’', label: 'right single quote' },
  { char: '“', label: 'left double quote' },
  { char: '”', label: 'right double quote' },
]

interface StylePreview {
  face: PreviewFace | null
  report: FontReport | null
  error: string | null
}

interface Props {
  glyphs: GlyphsByStyle
  uploadedStyles: Set<StyleId>
  generate: GenerateSettings
  onGenerate: (g: GenerateSettings) => void
}

export function PreviewStep({ glyphs, uploadedStyles, generate, onGenerate }: Props) {
  const [settings, setSettings] = useState<FontSettings>(DEFAULT_FONT_SETTINGS)
  const [text, setText] = useState(SAMPLE_TEXT)
  const [size, setSize] = useState(48)
  const [previews, setPreviews] = useState<Partial<Record<StyleId, StylePreview>>>({})
  const [hidden, setHidden] = useState<Set<StyleId>>(new Set())
  const [downloaded, setDownloaded] = useState<string[] | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const faces = useRef<PreviewFace[]>([])
  const textRef = useRef<HTMLTextAreaElement>(null)

  const available = STYLES.filter((s) => usableCount(glyphs[s.id]) > 0)
  const availableKey = available.map((s) => s.id).join(',')

  // Rebuild every available style's preview font (debounced) when glyphs or spacing change.
  useEffect(() => {
    if (!available.length) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const next: Partial<Record<StyleId, StylePreview>> = {}
      const loaded: PreviewFace[] = []
      for (const s of available) {
        try {
          const built = buildProjectFont(glyphs[s.id], settings, undefined, s.id, generate.slant)
          const report = validateFont(built.buffer, EXPECTED)
          try {
            const face = await loadPreviewFont(built.buffer)
            loaded.push(face)
            next[s.id] = { face, report, error: null }
          } catch (e) {
            next[s.id] = { face: null, report, error: `Your browser rejected the font: ${e}` }
          }
        } catch (e) {
          next[s.id] = { face: null, report: null, error: `Couldn't build the font: ${e}` }
        }
      }
      if (cancelled) {
        loaded.forEach(unloadPreviewFont)
        return
      }
      faces.current.forEach(unloadPreviewFont)
      faces.current = loaded
      setPreviews(next)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glyphs, availableKey, settings.letterSpacing, settings.wordSpacing, generate.slant])

  useEffect(() => () => faces.current.forEach(unloadPreviewFont), [])

  function insert(ch: string) {
    const el = textRef.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    setText(text.slice(0, start) + ch + text.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + ch.length, start + ch.length)
    })
  }

  function onDownload() {
    setDownloadError(null)
    // One build code for the whole family, so Windows links Regular, Bold and Italic together.
    const suffix = settings.addBuildSuffix ? buildSuffix() : undefined
    const files: { name: string; buffer: ArrayBuffer }[] = []
    for (const s of available) {
      const built = buildProjectFont(glyphs[s.id], settings, suffix, s.id, generate.slant)
      const report = validateFont(built.buffer, EXPECTED)
      if (!report.ok) {
        setDownloadError(`The ${s.label} font failed its checks, so nothing was downloaded: ${report.errors.join(' ')}`)
        return
      }
      files.push({ name: `${built.familyName.replace(/[^A-Za-z0-9]+/g, '')}-${s.label.replace(/\s+/g, '')}.otf`, buffer: built.buffer })
    }
    files.forEach((f, i) => setTimeout(() => downloadBlob(f.buffer, f.name, 'font/otf'), i * 400))
    const base = settings.familyName.trim() || DEFAULT_FONT_SETTINGS.familyName
    setDownloaded([`Font name “${suffix ? `${base} ${suffix}` : base}”`, ...files.map((f) => f.name)])
  }

  if (!available.length) {
    return (
      <section aria-labelledby="step-preview" className="pending">
        <h2 id="step-preview">4. Preview and download your font</h2>
        <p className="note">Upload your scans to preview your font here.</p>
      </section>
    )
  }

  const set = (patch: Partial<FontSettings>) => setSettings((s) => ({ ...s, ...patch }))
  const gen = (patch: Partial<GenerateSettings>) => onGenerate({ ...generate, ...patch })
  const regular = previews.regular
  const shown = available.filter((s) => !hidden.has(s.id))

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

      <fieldset className="styles-panel">
        <legend>Bold and italic</legend>
        <div className="row">
          <label>
            <input type="checkbox" checked={generate.bold} onChange={(e) => gen({ bold: e.target.checked })} /> Generate Bold
            from Regular{uploadedStyles.has('bold') && ' (for characters missing from your Bold set)'}
          </label>
          <label>
            thickness <output>+{generate.boldAmount}</output>
            <input
              type="range"
              min={1}
              max={4}
              step={0.5}
              value={generate.boldAmount}
              disabled={!generate.bold}
              onChange={(e) => gen({ boldAmount: Number(e.target.value) })}
              aria-label="Generated bold thickness"
            />
          </label>
        </div>
        <div className="row">
          <label>
            <input type="checkbox" checked={generate.italic} onChange={(e) => gen({ italic: e.target.checked })} /> Generate
            Italic and Bold Italic by slanting
          </label>
          <label>
            slant <output>{generate.slant}°</output>
            <input
              type="range"
              min={4}
              max={20}
              step={1}
              value={generate.slant}
              disabled={!generate.italic}
              onChange={(e) => gen({ slant: Number(e.target.value) })}
              aria-label="Generated italic slant"
            />
          </label>
        </div>
        <p className="note">
          Written sets (printed from step 1 with a thicker pen, or in cursive) always take priority. In Word, Ctrl+B and
          Ctrl+I switch to these styles once all the font files are installed.
        </p>
      </fieldset>

      <label className="block">
        Preview text
        <textarea ref={textRef} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="row insert-row" role="group" aria-label="Insert a special character">
        <span className="note">Insert:</span>
        {INSERTABLE.map((c) => (
          <button key={c.char} className="secondary char-button" onClick={() => insert(c.char)} title={c.label} aria-label={`Insert ${c.label}`}>
            {c.char}
          </button>
        ))}
      </div>
      {available.length > 1 && (
        <div className="row" role="group" aria-label="Styles to preview">
          <span className="note">Show:</span>
          {available.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={!hidden.has(s.id)}
                onChange={(e) =>
                  setHidden((h) => {
                    const next = new Set(h)
                    if (e.target.checked) next.delete(s.id)
                    else next.add(s.id)
                    return next
                  })
                }
              />{' '}
              {s.label}
            </label>
          ))}
        </div>
      )}

      {shown.map((s) => {
        const p = previews[s.id]
        return (
          <div key={s.id} className="style-preview">
            {available.length > 1 && <h3>{s.label}</h3>}
            {p?.face ? (
              <div
                className="font-preview"
                data-testid={s.id === 'regular' ? 'font-preview' : `font-preview-${s.id}`}
                style={{ fontFamily: `'${p.face.family}', sans-serif`, fontSize: `${size}px` }}
              >
                {text}
              </div>
            ) : (
              !p?.error && <p className="note">Building your font…</p>
            )}
          </div>
        )
      })}

      {regular?.report && (
        <ul className="checks" data-testid="font-checks">
          <li className={regular.report.missing.length ? 'warn' : 'good'}>
            {EXPECTED.length - regular.report.missing.length} of {EXPECTED.length} characters in the font
            {regular.report.missing.length > 0 && (
              <> (missing: {regular.report.missing.map((c) => (c === ' ' ? 'space' : c)).join(' ')})</>
            )}
          </li>
          <li className={regular.report.errors.length ? 'bad' : 'good'}>
            {regular.report.errors.length
              ? regular.report.errors.join(' ')
              : 'Line height covers every letter, so Windows won’t clip tails or tall letters'}
          </li>
          <li className={regular.report.badWinding.length ? 'bad' : 'good'}>
            {regular.report.badWinding.length
              ? `Outline direction problems: ${regular.report.badWinding.join(', ')}`
              : 'Letter holes (o, e, a, 8…) are set up correctly'}
          </li>
          <li className={regular.face ? 'good' : 'bad'}>{regular.face ? 'Your browser accepted the font' : 'Your browser rejected the font'}</li>
          {available
            .filter((s) => s.id !== 'regular')
            .map((s) => {
              const p = previews[s.id]
              const ok = p?.report?.ok && p.face
              return (
                <li key={s.id} className={ok ? 'good' : 'bad'} data-testid={`check-${s.id}`}>
                  {s.label}: {p?.report ? `${EXPECTED.length - p.report.missing.length} of ${EXPECTED.length} characters` : 'building…'}
                  {p?.report && (ok ? ', all checks pass' : `, ${p.error ?? p.report.errors.join(' ')}`)}
                </li>
              )
            })}
        </ul>
      )}
      {available.map((s) => previews[s.id]?.error && (
        <p key={s.id} role="alert" className="bad">
          {s.label}: {previews[s.id]!.error}
        </p>
      ))}

      <div className="row download-row">
        <label>
          Font name <input value={settings.familyName} onChange={(e) => set({ familyName: e.target.value })} />
        </label>
        <label>
          <input type="checkbox" checked={settings.addBuildSuffix} onChange={(e) => set({ addBuildSuffix: e.target.checked })} /> Add a
          build code to the name
        </label>
        <button onClick={onDownload} disabled={!regular?.report}>
          {available.length > 1 ? `Download ${available.length} font files` : 'Download OTF'}
        </button>
      </div>
      <p className="note">
        The build code (e.g. “My Handwriting {buildSuffix()}”) changes each time, so Windows never shows an older installed
        copy. To install: open each downloaded .otf file and click Install, then restart Word.
        {available.length > 1 && ' Your browser may ask permission to download several files.'}
      </p>
      {downloadError && (
        <p role="alert" className="bad">
          {downloadError}
        </p>
      )}
      {downloaded && (
        <div className="good" role="status" data-testid="downloaded">
          Downloaded: {downloaded.join(' · ')}
        </div>
      )}
    </section>
  )
}
