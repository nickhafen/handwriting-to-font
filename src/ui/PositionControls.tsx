import { DEFAULT_METRICS, type GlyphMetrics } from '../core/project'

type Field = { key: keyof GlyphMetrics; label: string; hint: string; min: number; max: number; step: number }

const FIELDS: Field[] = [
  { key: 'scale', label: 'Size', hint: 'Grow or shrink the character from the baseline', min: 50, max: 200, step: 5 },
  { key: 'shiftY', label: 'Move up / down', hint: 'Raise (+) or lower (−) the character; its shape is unchanged', min: -250, max: 250, step: 10 },
  { key: 'spaceBefore', label: 'Space before', hint: 'Extra room on the left', min: -60, max: 200, step: 5 },
  { key: 'spaceAfter', label: 'Space after', hint: 'Extra room on the right', min: -60, max: 200, step: 5 },
]

interface Props {
  value: GlyphMetrics | undefined
  onChange: (m: GlyphMetrics) => void
  idPrefix: string
}

/** Per-character position and spacing sliders (font units; the x-height is 480). */
export function PositionControls({ value, onChange, idPrefix }: Props) {
  const v = value ?? DEFAULT_METRICS
  return (
    <div className="controls ink-controls">
      {FIELDS.map((f) => {
        const id = `${idPrefix}-${f.key}`
        // Size is stored as a factor and shown as a percentage.
        const isScale = f.key === 'scale'
        const n = isScale ? Math.round((v.scale ?? 1) * 100) : (v[f.key] as number)
        return (
          <label key={f.key} htmlFor={id}>
            <span>
              {f.label} <output htmlFor={id}>{isScale ? `${n}%` : n > 0 ? `+${n}` : n}</output>
            </span>
            <input
              id={id}
              type="range"
              min={f.min}
              max={f.max}
              step={f.step}
              value={n}
              aria-describedby={`${id}-hint`}
              onChange={(e) => onChange({ ...v, [f.key]: isScale ? Number(e.target.value) / 100 : Number(e.target.value) })}
            />
            <small id={`${id}-hint`} className="note">
              {f.hint}
            </small>
          </label>
        )
      })}
    </div>
  )
}
