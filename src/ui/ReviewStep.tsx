import { useEffect, useRef, useState } from 'react'
import type { ReviewGlyph } from '../core/project'
import type { CellResult } from '../core/scan/cells'
import { PX_PER_PT, UNITS, UNITS_PER_PT } from '../core/template/layout'
import type { InkAdjust } from '../core/scan/adjust'
import { GlyphOutline } from './GlyphOutline'
import { InkControls } from './InkControls'
import { PAGE_NAMES } from './UploadStep'

/** Pixel row in a cell crop where a font-unit height falls. */
const unitsToRow = (u: number) => ((UNITS.top - u) / UNITS_PER_PT) * PX_PER_PT

const BASELINE = 'rgba(214, 40, 40, 0.75)'
const XHEIGHT = 'rgba(30, 110, 200, 0.6)'

/**
 * Draw a cell (ink mask or original grayscale) with guide overlays, at about
 * `displayWidth` CSS pixels. Scaling here (with smoothing) instead of letting
 * CSS shrink a full-size canvas keeps thin lines from flickering in and out.
 */
function CellCanvas({ cell, mode, displayWidth }: { cell: CellResult; mode: 'ink' | 'gray'; displayWidth: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const full = new OffscreenCanvas(cell.width, cell.height)
    const fctx = full.getContext('2d')!
    const img = fctx.createImageData(cell.width, cell.height)
    for (let i = 0; i < cell.ink.length; i++) {
      const v = mode === 'ink' ? (cell.ink[i] ? 0 : 255) : cell.gray[i]
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
      img.data[i * 4 + 3] = 255
    }
    fctx.putImageData(img, 0, 0)

    const dpr = window.devicePixelRatio || 1
    const scale = Math.min(1, (displayWidth * dpr) / cell.width)
    canvas.width = Math.round(cell.width * scale)
    canvas.height = Math.round(cell.height * scale)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height)
    const line = (u: number, color: string, dash: number[] = []) => {
      const y = Math.round(unitsToRow(u) * scale) + 0.5
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5 * dpr
      ctx.setLineDash(dash.map((d) => d * dpr))
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(canvas.width, y)
      ctx.stroke()
    }
    line(UNITS.baseline, BASELINE)
    line(UNITS.xHeight, XHEIGHT, [4, 3])
  }, [cell, mode, displayWidth])
  return <canvas ref={ref} aria-hidden="true" />
}

function badges(g: ReviewGlyph, adjusted = false): { text: string; kind: 'bad' | 'warn' | 'info' }[] {
  const out: { text: string; kind: 'bad' | 'warn' | 'info' }[] = []
  if (g.empty) out.push({ text: 'empty', kind: 'bad' })
  if (g.clipped) out.push({ text: 'clipped', kind: 'warn' })
  if (g.suspicious) out.push({ text: 'check size', kind: 'warn' })
  if (adjusted) out.push({ text: 'adjusted', kind: 'info' })
  if (g.usesFallback) out.push({ text: `uses ${g.info.fallbackFrom}`, kind: 'info' })
  return out
}

function describe(g: ReviewGlyph): string {
  const b = badges(g).map((x) => x.text)
  return `${g.info.char}${g.info.hint ? ` (${g.info.hint})` : ''}${b.length ? `: ${b.join(', ')}` : ''}`
}

interface Props {
  glyphs: ReviewGlyph[]
  adjust: InkAdjust
  onAdjust: (a: InkAdjust) => void
  overrides: Record<string, InkAdjust>
  onOverride: (char: string, a: InkAdjust | null) => void
  busy: boolean
}

export function ReviewStep({ glyphs, adjust, onAdjust, overrides, onOverride, busy }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const anyPage = glyphs.some((g) => !g.pageMissing)
  const sel = glyphs.find((g) => g.info.char === selected && g.cell)

  if (!anyPage) {
    return (
      <section aria-labelledby="step-review" className="pending">
        <h2 id="step-review">3. Review your letters</h2>
        <p className="note">Upload at least one page to see your letters here.</p>
      </section>
    )
  }

  const counts = {
    ready: glyphs.filter((g) => g.cell && !g.empty).length,
    empty: glyphs.filter((g) => g.empty).length,
    flagged: glyphs.filter((g) => g.clipped || g.suspicious).length,
    missing: glyphs.filter((g) => g.pageMissing).length,
  }

  return (
    <section aria-labelledby="step-review">
      <h2 id="step-review">3. Review your letters</h2>
      <p data-testid="review-summary">
        {counts.ready} of {glyphs.length} characters ready
        {counts.empty > 0 && `, ${counts.empty} empty`}
        {counts.flagged > 0 && `, ${counts.flagged} to check`}
        {counts.missing > 0 && `, ${counts.missing} on a page not uploaded yet`}.
      </p>
      <p className="note">
        <span className="swatch baseline" /> baseline <span className="swatch xheight" /> x-height. Letters are drawn from their traced
        outlines. Click one to compare it with the original scan and adjust it on its own.
      </p>
      <details className="ink-panel" open>
        <summary>Ink settings for all letters</summary>
        <p className="note">
          If parts of letters are missing, raise <b>Ink sensitivity</b>. For bolder letters, raise <b>Stroke thickness</b>.
          Letters you have adjusted individually keep their own settings.
        </p>
        <InkControls idPrefix="all" value={adjust} onChange={onAdjust} />
      </details>
      <p className="note busy" role="status" aria-live="polite" data-testid="retrace-status">
        {busy ? 'Updating letters…' : ' '}
      </p>
      {sel?.cell && (
        <div className="detail" role="region" aria-label={`Details for ${sel.info.char}`}>
          <div className="detail-head">
            <b>{describe(sel)}</b>
            <button className="secondary" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <div className="detail-images">
            <figure>
              <CellCanvas cell={sel.cell} mode="gray" displayWidth={281} />
              <figcaption>Original scan</figcaption>
            </figure>
            <figure>
              <CellCanvas cell={sel.cell} mode="ink" displayWidth={281} />
              <figcaption>Cleaned ink</figcaption>
            </figure>
            <figure>
              <GlyphOutline contours={sel.cell.contours} className="outline-large" />
              <figcaption>Traced outline ({sel.cell.contours.length} contours)</figcaption>
            </figure>
          </div>
          <div className="letter-adjust">
            <h4>
              Adjust this letter only{overrides[sel.info.char] && <span className="badge info">adjusted</span>}
            </h4>
            {sel.usesFallback && (
              <p className="note">
                This blank character is using {sel.info.fallbackFrom} instead. Adjusting it reprocesses its own (blank) box.
              </p>
            )}
            <InkControls
              idPrefix={`letter-${sel.info.unicode}`}
              value={overrides[sel.info.char] ?? adjust}
              onChange={(a) => onOverride(sel.info.char, a)}
            />
            <button className="secondary" disabled={!overrides[sel.info.char]} onClick={() => onOverride(sel.info.char, null)}>
              Use the all-letters settings
            </button>
          </div>
          {sel.cell.yMaxUnits !== null && (
            <p className="note">
              Ink runs from {Math.round(sel.cell.yMinUnits!)} to {Math.round(sel.cell.yMaxUnits)} font units (baseline =
              0, x-height = {UNITS.xHeight}).
            </p>
          )}
        </div>
      )}
      {[0, 1].map((pageIndex) => (
        <div key={pageIndex}>
          <h3>{PAGE_NAMES[pageIndex]}</h3>
          <ul className="glyph-grid" data-testid={`glyph-grid-${pageIndex}`}>
            {glyphs
              .filter((g) => g.pageIndex === pageIndex)
              .map((g) => (
                <li key={g.info.char}>
                  <button
                    className={`glyph${g.info.char === selected ? ' selected' : ''}`}
                    disabled={!g.cell}
                    onClick={() => setSelected(g.info.char)}
                    aria-label={describe(g)}
                    data-testid="glyph"
                    data-char={g.info.char}
                    data-ink={g.cell?.inkArea ?? 0}
                    data-state={g.pageMissing ? 'missing' : g.empty ? 'empty' : 'ok'}
                  >
                    <span className="glyph-char">{g.info.char}</span>
                    {g.cell && !g.empty ? <GlyphOutline contours={g.cell.contours} /> : <span className="glyph-blank" />}
                    <span className="badges">
                      {badges(g, !!overrides[g.info.char]).map((b) => (
                        <span key={b.text} className={`badge ${b.kind}`}>
                          {b.text}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
