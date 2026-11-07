import type { LigatureFeature } from '../core/font/gsub'
import { ligatureKey, usable, type GlyphMetrics, type LigatureGlyph } from '../core/project'
import { PX_PER_PT, UNITS_PER_PT } from '../core/template/layout'
import { ligatureBoxes, ligatureSheetName } from '../core/template/ligatures'
import { GlyphOutline } from './GlyphOutline'

const FEATURES: { id: LigatureFeature; label: string }[] = [
  { id: 'liga', label: 'Standard' },
  { id: 'dlig', label: 'Discretionary' },
  { id: 'calt', label: 'Contextual' },
]

/** Plain-language status for a ligature box. */
export function ligatureStatus(g: LigatureGlyph): { text: string; kind: 'good' | 'warn' | 'bad' } {
  if (g.empty) return { text: 'Blank', kind: 'warn' }
  if (g.parsed.kind === 'none') return { text: 'Type what this box holds', kind: 'warn' }
  if (g.parsed.kind === 'error') return { text: g.parsed.message, kind: 'bad' }
  if (g.duplicate) return { text: 'Another box has the same text and is used instead', kind: 'warn' }
  if (!usable(g)) return { text: 'No outline traced', kind: 'bad' }
  if (g.parsed.kind === 'alternate') {
    const { before, target, after } = g.parsed
    const ctx = [before.length ? `after “${before.join('')}”` : '', after.length ? `before “${after.join('')}”` : ''].filter(Boolean).join(' and ')
    return { text: `“${target}” ${ctx}`, kind: 'good' }
  }
  return { text: `Replaces “${g.parsed.chars.join('')}”`, kind: 'good' }
}

interface Props {
  ligatures: LigatureGlyph[]
  selected: string | null
  onSelect: (key: string) => void
  onText: (key: string, text: string) => void
  onFeature: (key: string, f: LigatureFeature) => void
  metricsOf: (g: LigatureGlyph) => GlyphMetrics | undefined
  isAdjusted: (g: LigatureGlyph) => boolean
}

export function LigatureGrid({ ligatures, selected, onSelect, onText, onFeature, metricsOf, isAdjusted }: Props) {
  const sheets = [...new Set(ligatures.map((g) => g.sheet))]
  return (
    <>
      {sheets.map((sheet) => {
        const all = ligatures.filter((g) => g.sheet === sheet)
        const shown = all.filter((g) => !g.empty || g.text)
        const blank = all.length - shown.length
        return (
          <div key={sheet}>
            <h3>{ligatureSheetName(sheet)}</h3>
            {blank > 0 && <p className="note">{blank} blank boxes not shown.</p>}
            <ul className="glyph-grid ligature-grid" data-testid={`ligature-grid-${sheet}`}>
              {shown.map((g) => {
                const key = ligatureKey(g.sheet, g.box)
                const span = ligatureBoxes(g.sheet)[g.box]?.span ?? 1
                const status = ligatureStatus(g)
                const widthUnits = g.cell ? (g.cell.width / PX_PER_PT) * UNITS_PER_PT : undefined
                const m = metricsOf(g)
                return (
                  <li key={key} style={{ gridColumn: `span ${span}` }} className="ligature-tile" data-testid="ligature" data-key={key}>
                    <button
                      className={`glyph${key === selected ? ' selected' : ''}`}
                      disabled={!g.cell}
                      onClick={() => onSelect(key)}
                      aria-haspopup="dialog"
                      aria-label={`Box ${g.box + 1}${g.text ? `, ${g.text}` : ''}: ${status.text}`}
                    >
                      <span className="glyph-char">
                        Box {g.box + 1}
                        {isAdjusted(g) && <span className="badge info">adjusted</span>}
                        {g.clipped && <span className="badge warn">clipped</span>}
                      </span>
                      {usable(g) ? (
                        <GlyphOutline
                          contours={g.outline}
                          widthUnits={widthUnits}
                          shiftY={m?.shiftY}
                          scale={m?.scale}
                          style={g.cell ? { aspectRatio: `${g.cell.width} / ${g.cell.height}` } : undefined}
                        />
                      ) : (
                        <span className="glyph-blank" />
                      )}
                    </button>
                    <div className="ligature-fields">
                      <input
                        value={g.text}
                        onChange={(e) => onText(key, e.target.value)}
                        placeholder="e.g. th or r[e]"
                        aria-label={`What box ${g.box + 1} holds`}
                        data-testid="ligature-text"
                      />
                      {g.parsed.kind === 'ligature' && (
                        <select
                          value={g.feature}
                          onChange={(e) => onFeature(key, e.target.value as LigatureFeature)}
                          aria-label={`Kind of ligature for box ${g.box + 1}`}
                        >
                          {FEATURES.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <span className={`ligature-status ${status.kind}`} data-testid="ligature-status">
                      {status.text}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </>
  )
}
