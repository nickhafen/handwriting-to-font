import { ADJUST_RANGES, type InkAdjust } from '../core/scan/adjust'

const LABELS: Record<keyof InkAdjust, { label: string; hint: string; format: (v: number) => string }> = {
  sensitivity: {
    label: 'Ink sensitivity',
    hint: 'Higher picks up fainter parts of strokes',
    format: (v) => String(v),
  },
  thickness: {
    label: 'Stroke thickness',
    hint: 'Thicken or thin every line',
    format: (v) => (v > 0 ? `+${v}` : String(v)),
  },
  smoothing: {
    label: 'Smoothing',
    hint: 'Higher rounds off corners',
    format: (v) => String(v),
  },
}

interface Props {
  value: InkAdjust
  onChange: (a: InkAdjust) => void
  /** Prefix for input ids, so several panels can coexist. */
  idPrefix: string
}

export function InkControls({ value, onChange, idPrefix }: Props) {
  return (
    <div className="controls ink-controls">
      {(Object.keys(LABELS) as (keyof InkAdjust)[]).map((k) => {
        const { label, hint, format } = LABELS[k]
        const range = ADJUST_RANGES[k]
        const id = `${idPrefix}-${k}`
        return (
          <label key={k} htmlFor={id}>
            <span>
              {label} <output htmlFor={id}>{format(value[k])}</output>
            </span>
            <input
              id={id}
              type="range"
              min={range.min}
              max={range.max}
              step={range.step}
              value={value[k]}
              aria-describedby={`${id}-hint`}
              onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })}
            />
            <small id={`${id}-hint`} className="note">
              {hint}
            </small>
          </label>
        )
      })}
    </div>
  )
}
