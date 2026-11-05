import { useState } from 'react'
import { buildFont, buildSuffix } from '../core/font/build'
import { DEFAULT_SPACING } from '../core/font/metrics'
import { m0TestGlyphs } from '../core/font/m0TestGlyphs'
import { validateFont, type FontReport } from '../core/font/validate'
import { downloadBlob, loadPreviewFont } from './fontFace'

const EXPECTED = [' ', 'o', 'p', 'l']

interface Result {
  familyName: string
  fileName: string
  report: FontReport
  previewFamily: string | null
  fontFaceError: string | null
}

export function FontCheck() {
  const [baseName, setBaseName] = useState('HW Risk Check')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState('pool lol\nloop pop')

  async function onBuild() {
    setError(null)
    try {
      const familyName = `${baseName.trim() || 'HW Risk Check'} ${buildSuffix()}`
      const built = buildFont({ familyName, glyphs: m0TestGlyphs(), spacing: DEFAULT_SPACING, spaceWidth: 280 })
      const report = validateFont(built.buffer, EXPECTED)
      let previewFamily: string | null = null
      let fontFaceError: string | null = null
      try {
        previewFamily = await loadPreviewFont(built.buffer)
      } catch (e) {
        fontFaceError = String(e)
      }
      const fileName = `${familyName.replace(/\s+/g, '')}-Regular.otf`
      downloadBlob(built.buffer, fileName, 'font/otf')
      setResult({ familyName, fileName, report, previewFamily, fontFaceError })
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <section aria-labelledby="font-check-h">
      <h2 id="font-check-h">1. Font build check</h2>
      <p>
        Builds a tiny OTF with three hand-drawn test letters — <b>o</b> (hole), <b>p</b> (hole + descender), and{' '}
        <b>l</b> (tall ascender) — plus a space, then downloads it.
      </p>
      <div className="row">
        <label>
          Font name{' '}
          <input value={baseName} onChange={(e) => setBaseName(e.target.value)} aria-describedby="suffix-note" />
        </label>
        <button onClick={onBuild}>Build &amp; download OTF</button>
      </div>
      <p id="suffix-note" className="note">
        A 4-character build code is added to the name each time, so Windows never shows a cached older copy.
      </p>
      {error && <p role="alert" className="bad">Build failed: {error}</p>}
      {result && (
        <div className="result">
          <p>
            Downloaded <code>{result.fileName}</code> — family name <b>{result.familyName}</b>.
          </p>
          <ul className="checks">
            <li className={result.report.missing.length ? 'bad' : 'good'}>
              Character map: {result.report.missing.length ? `missing ${result.report.missing.join(' ')}` : 'space, o, p, l all present'}
            </li>
            <li className={result.report.ok ? 'good' : 'bad'}>
              Windows metrics: usWinAscent {result.report.stats.usWinAscent} ≥ tallest glyph {result.report.stats.maxYMax};
              usWinDescent {result.report.stats.usWinDescent} ≥ lowest descender {Math.abs(result.report.stats.minYMin)}
            </li>
            <li className={result.report.stats.fsType === 0 ? 'good' : 'bad'}>
              Embedding: fsType = {result.report.stats.fsType} (0 = installable)
            </li>
            <li className={result.previewFamily ? 'good' : 'bad'}>
              Browser sanitizer: {result.previewFamily ? 'accepted (loaded via FontFace)' : `rejected — ${result.fontFaceError}`}
            </li>
          </ul>
          {result.report.errors.length > 0 && (
            <ul className="bad">
              {result.report.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {result.previewFamily && (
            <>
              <label className="block">
                Preview text (only o, p, l and space exist in this font)
                <textarea rows={2} value={previewText} onChange={(e) => setPreviewText(e.target.value)} />
              </label>
              <div className="preview" style={{ fontFamily: `'${result.previewFamily}', monospace` }}>
                {previewText}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
