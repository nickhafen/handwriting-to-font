import { useEffect, useRef, useState } from 'react'
import type { LigatureFeature } from '../core/font/gsub'
import {
  isDefaultMetrics,
  metricsKeyFor,
  usable,
  type GlyphMetrics,
  type GlyphsByStyle,
  type LigatureGlyph,
  type ReviewGlyph,
} from '../core/project'
import { ligatureSheetName } from '../core/template/ligatures'
import { DEFAULT_ADJUST, sameAdjust, type InkAdjust } from '../core/scan/adjust'
import type { CellResult } from '../core/scan/cells'
import { PX_PER_PT, UNITS, UNITS_PER_PT } from '../core/template/layout'
import { PAGE_NAMES, STYLES, styleInfo, type StyleId } from '../core/template/styles'
import { GlyphOutline } from './GlyphOutline'
import { InkControls } from './InkControls'
import { LigatureGrid, ligatureStatus } from './LigatureGrid'
import { PositionControls } from './PositionControls'
import { overrideKey } from './useProject'

/** Pixel row in a cell crop where a font-unit height falls. */
const unitsToRow = (u: number) => ((UNITS.top - u) / UNITS_PER_PT) * PX_PER_PT

const BASELINE = 'rgba(214, 40, 40, 0.75)'
const XHEIGHT = 'rgba(30, 110, 200, 0.6)'

/**
 * Draw a cell (ink mask or original grayscale) with guide overlays, at about
 * `displayWidth` CSS pixels. Scaling here (with smoothing) instead of letting
 * CSS shrink a full-size canvas keeps thin lines from flickering in and out.
 */
function CellCanvas({ cell, mode, displayWidth, cssWidth }: { cell: CellResult; mode: 'ink' | 'gray'; displayWidth: number; cssWidth?: number }) {
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
  return <canvas ref={ref} aria-hidden="true" style={cssWidth ? { width: cssWidth } : undefined} />
}

interface Badge {
  text: string
  kind: 'bad' | 'warn' | 'info' | 'redo'
}

function badges(g: ReviewGlyph, adjusted: boolean, redo: boolean): Badge[] {
  const out: Badge[] = []
  if (g.empty) out.push({ text: 'empty', kind: 'bad' })
  if (g.clipped) out.push({ text: 'clipped', kind: 'warn' })
  if (g.suspicious) out.push({ text: 'check size', kind: 'warn' })
  if (adjusted) out.push({ text: 'adjusted', kind: 'info' })
  if (redo) out.push({ text: 'redo', kind: 'redo' })
  if (g.usesFallback) out.push({ text: `uses ${g.info.fallbackFrom}`, kind: 'info' })
  if (g.generated) out.push({ text: 'generated', kind: 'info' })
  return out
}

function describe(g: ReviewGlyph, b: Badge[]): string {
  const t = b.map((x) => x.text)
  return `${g.info.char}${g.info.hint ? ` (${g.info.hint})` : ''}${t.length ? `: ${t.join(', ')}` : ''}`
}

interface Props {
  glyphs: GlyphsByStyle
  uploadedStyles: Set<StyleId>
  adjust: InkAdjust
  onAdjust: (a: InkAdjust) => void
  overrides: Record<string, InkAdjust>
  onOverride: (style: StyleId, char: string, a: InkAdjust | null) => void
  onApplyToAll: (a: InkAdjust) => void
  redo: Set<string>
  onToggleRedo: (style: StyleId, char: string) => void
  metrics: Record<string, GlyphMetrics>
  onMetrics: (key: string, m: GlyphMetrics | null) => void
  ligatures: LigatureGlyph[]
  onLigatureText: (key: string, text: string) => void
  onLigatureFeature: (key: string, f: LigatureFeature) => void
  busy: boolean
}

type TabId = StyleId | 'ligatures'
const isLigature = (g: ReviewGlyph): g is LigatureGlyph => 'sheet' in g

export function ReviewStep(p: Props) {
  const { glyphs, uploadedStyles, adjust, overrides, redo, busy, metrics } = p
  const [style, setStyle] = useState<TabId>('regular')
  const [selected, setSelected] = useState<string | null>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  // Styles worth showing: uploaded ones, plus any that have generated glyphs.
  const visible: { id: TabId; label: string; generated?: boolean }[] = STYLES.filter(
    (s) => uploadedStyles.has(s.id) || glyphs[s.id].some(usable),
  ).map((s) => ({ id: s.id, label: s.label, generated: !uploadedStyles.has(s.id) }))
  if (p.ligatures.length) visible.push({ id: 'ligatures', label: 'Ligatures' })
  const current: TabId = visible.some((s) => s.id === style) ? style : 'regular'
  const list: ReviewGlyph[] = current === 'ligatures' ? p.ligatures : glyphs[current]
  const selIndex = list.findIndex((g) => g.info.char === selected)
  const sel = selIndex >= 0 ? list[selIndex] : undefined

  // Esc closes the drawer.
  useEffect(() => {
    if (!sel) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel])

  if (!uploadedStyles.size && !p.ligatures.length) {
    return (
      <section aria-labelledby="step-review" className="pending">
        <h2 id="step-review">3. Review your letters</h2>
        <p className="note">Upload at least one page to see your letters here.</p>
      </section>
    )
  }

  const counts = {
    ready: list.filter(usable).length,
    empty: list.filter((g) => g.empty && !g.generated).length,
    flagged: list.filter((g) => g.clipped || g.suspicious).length,
    missing: list.filter((g) => g.pageMissing && !g.generated).length,
  }
  const metricsOf = (g: ReviewGlyph) => metrics[metricsKeyFor(g)]
  const isAdjusted = (g: ReviewGlyph) => !!overrides[overrideKey(g.style, g.info.char)] || !isDefaultMetrics(metricsOf(g))
  const isRedo = (g: ReviewGlyph) => redo.has(overrideKey(g.style, g.info.char))
  const step = (d: number) => {
    // Next/previous glyph that has something to show.
    for (let i = selIndex + d; i >= 0 && i < list.length; i += d) {
      if (list[i].cell) return setSelected(list[i].info.char)
    }
  }
  const globalChanged = !sameAdjust(adjust, DEFAULT_ADJUST)

  return (
    <section aria-labelledby="step-review">
      <h2 id="step-review">3. Review your letters</h2>

      {visible.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Font style">
          {visible.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={s.id === current}
              className={s.id === current ? 'tab active' : 'tab'}
              onClick={() => {
                setStyle(s.id)
                setSelected(null)
              }}
            >
              {s.label}
              {s.generated && <span className="muted"> (generated)</span>}
            </button>
          ))}
        </div>
      )}

      {current === 'ligatures' ? (
        <p data-testid="review-summary">
          {p.ligatures.filter((g) => ligatureStatus(g).kind === 'good').length} ligatures and alternates ready.{' '}
          {(() => {
            const n = p.ligatures.filter((g) => !g.empty && g.parsed.kind === 'none').length
            return n > 0 ? `${n} ${n === 1 ? 'box needs its' : 'boxes need their'} text typed in.` : ''
          })()}
        </p>
      ) : (
      <p data-testid="review-summary">
        {counts.ready} of {list.length} characters ready
        {counts.empty > 0 && `, ${counts.empty} empty`}
        {counts.flagged > 0 && `, ${counts.flagged} to check`}
        {counts.missing > 0 && `, ${counts.missing} on a page not uploaded yet`}.
      </p>
      )}
      <p className="note">
        <span className="swatch baseline" /> baseline <span className="swatch xheight" /> x-height. Click a letter to
        compare it with the scan, adjust it, or mark it for a redo sheet.
      </p>
      <details className="ink-panel">
        <summary>
          Ink settings for all letters{globalChanged && <span className="badge info">changed from default</span>}
        </summary>
        <p className="note">
          If parts of letters are missing, raise <b>Ink sensitivity</b>. For bolder letters, raise <b>Stroke thickness</b>.
          Letters you have adjusted individually keep their own settings.
        </p>
        <InkControls idPrefix="all" value={adjust} onChange={p.onAdjust} />
        <button className="secondary" disabled={!globalChanged} onClick={() => p.onAdjust({ ...DEFAULT_ADJUST })}>
          Reset to defaults
        </button>
      </details>
      <p className="note busy" role="status" aria-live="polite" data-testid="retrace-status">
        {busy ? 'Updating letters…' : ' '}
      </p>

      {current === 'ligatures' && (
        <LigatureGrid
          ligatures={p.ligatures}
          selected={selected}
          onSelect={setSelected}
          onText={p.onLigatureText}
          onFeature={p.onLigatureFeature}
          metricsOf={metricsOf}
          isAdjusted={isAdjusted}
        />
      )}

      {current !== 'ligatures' && [0, 1].map((pageIndex) => (
        <div key={pageIndex}>
          <h3>{PAGE_NAMES[pageIndex]}</h3>
          <ul className="glyph-grid" data-testid={`glyph-grid-${pageIndex}`}>
            {list
              .filter((g) => g.pageIndex === pageIndex)
              .map((g) => {
                const b = badges(g, isAdjusted(g), isRedo(g))
                return (
                  <li key={g.info.char}>
                    <button
                      className={`glyph${g.info.char === selected ? ' selected' : ''}`}
                      disabled={!g.cell}
                      onClick={() => setSelected(g.info.char)}
                      aria-label={describe(g, b)}
                      aria-haspopup="dialog"
                      data-testid="glyph"
                      data-char={g.info.char}
                      data-ink={g.cell?.inkArea ?? 0}
                      data-state={g.pageMissing ? 'missing' : g.empty ? 'empty' : 'ok'}
                    >
                      <span className="glyph-char">{g.info.char}</span>
                      {usable(g) ? <GlyphOutline contours={g.outline} shiftY={metricsOf(g)?.shiftY} scale={metricsOf(g)?.scale} /> : <span className="glyph-blank" />}
                      <span className="badges">
                        {b.map((x) => (
                          <span key={x.text} className={`badge ${x.kind}`}>
                            {x.text}
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                )
              })}
          </ul>
        </div>
      ))}

      {sel?.cell && (
        <>
          {/* Room so the last rows can scroll above the drawer. */}
          <div className="drawer-spacer" aria-hidden="true" />
          <div className="drawer" ref={drawerRef} role="dialog" aria-modal="false" aria-label={`Details for ${isLigature(sel) ? `box ${sel.box + 1}` : sel.info.char}`}>
            <div className="drawer-head">
              <b className="drawer-title">
                {isLigature(sel)
                  ? `Box ${sel.box + 1}${sel.text ? ` “${sel.text}”` : ''} (${ligatureSheetName(sel.sheet).toLowerCase()})`
                  : `${styleInfo(sel.style).label} “${sel.info.char}”${sel.info.hint ? ` (${sel.info.hint})` : ''}`}
              </b>
              <span className="badges">
                {badges(sel, isAdjusted(sel), isRedo(sel)).map((x) => (
                  <span key={x.text} className={`badge ${x.kind}`}>
                    {x.text}
                  </span>
                ))}
              </span>
              <span className="spacer" />
              <button className="secondary" onClick={() => step(-1)} disabled={selIndex <= 0} aria-label="Previous letter">
                ‹ Prev
              </button>
              <button className="secondary" onClick={() => step(1)} disabled={selIndex >= list.length - 1} aria-label="Next letter">
                Next ›
              </button>
              <button className="secondary" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <div className="drawer-body">
              <div className="detail-images">
                <figure>
                  <CellCanvas cell={sel.cell} mode="gray" displayWidth={(220 * sel.cell.width) / 281} cssWidth={(220 * sel.cell.width) / 281} />
                  <figcaption>{sel.generated ? 'Regular scan' : 'Original scan'}</figcaption>
                </figure>
                <figure>
                  <CellCanvas cell={sel.cell} mode="ink" displayWidth={(220 * sel.cell.width) / 281} cssWidth={(220 * sel.cell.width) / 281} />
                  <figcaption>Cleaned ink</figcaption>
                </figure>
                <figure>
                  <GlyphOutline
                    contours={sel.outline}
                    className="outline-large"
                    shiftY={metricsOf(sel)?.shiftY}
                    scale={metricsOf(sel)?.scale}
                    widthUnits={isLigature(sel) ? (sel.cell.width / PX_PER_PT) * UNITS_PER_PT : undefined}
                    style={isLigature(sel) ? { aspectRatio: `${sel.cell.width} / ${sel.cell.height}`, width: (220 * sel.cell.width) / 281 } : undefined}
                  />
                  <figcaption>Outline in the font ({sel.outline.length} contours)</figcaption>
                </figure>
              </div>
              <div className="letter-adjust">
                {sel.generated ? (
                  <p className="note">
                    Generated from your Regular “{sel.info.char}” ({sel.generated}). Adjust the Regular letter, change the
                    generation settings in step 4, or upload a written {styleInfo(sel.style).label} set.
                  </p>
                ) : (
                  <>
                    {sel.usesFallback && (
                      <p className="note">
                        This blank character is using {sel.info.fallbackFrom} instead. Adjusting it reprocesses its own
                        (blank) box.
                      </p>
                    )}
                    <InkControls
                      idPrefix={isLigature(sel) ? `lig-${sel.sheet}-${sel.box}` : `letter-${sel.info.unicode}`}
                      value={overrides[overrideKey(sel.style, sel.info.char)] ?? adjust}
                      onChange={(a) => p.onOverride(sel.style, sel.info.char, a)}
                    />
                    <div className="row">
                      <button
                        className="secondary"
                        disabled={!overrides[overrideKey(sel.style, sel.info.char)]}
                        onClick={() => p.onOverride(sel.style, sel.info.char, null)}
                      >
                        Revert to default
                      </button>
                      <button
                        className="secondary"
                        onClick={() => p.onApplyToAll(overrides[overrideKey(sel.style, sel.info.char)] ?? adjust)}
                      >
                        Apply to all letters
                      </button>
                    </div>
                  </>
                )}
                <h4 className="position-head">Size, position and spacing</h4>
                {sel.generated ? (
                  <p className="note">Uses the position and spacing of the Regular “{sel.info.char}”.</p>
                ) : (
                  <>
                    <PositionControls
                      idPrefix={isLigature(sel) ? `ligpos-${sel.sheet}-${sel.box}` : `pos-${sel.info.unicode}`}
                      value={metricsOf(sel)}
                      onChange={(m) => p.onMetrics(metricsKeyFor(sel), m)}
                    />
                    <button
                      className="secondary"
                      disabled={isDefaultMetrics(metricsOf(sel))}
                      onClick={() => p.onMetrics(metricsKeyFor(sel), null)}
                    >
                      Reset size, position and spacing
                    </button>
                  </>
                )}
                {!isLigature(sel) && (
                <label className="redo-toggle">
                  <input type="checkbox" checked={isRedo(sel)} onChange={() => p.onToggleRedo(sel.style, sel.info.char)} />{' '}
                  Mark for a redo sheet (print it in step 1)
                </label>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
