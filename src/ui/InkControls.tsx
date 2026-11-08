import { ADJUST_RANGES, type InkAdjust } from '../core/scan/adjust'
import { SliderRow } from './SliderRow'

const FIELDS: { key: keyof InkAdjust; label: string; hint: string; format: (v: number) => string }[] = [
  { key: 'sensitivity', label: 'Ink sensitivity', hint: 'Higher picks up fainter parts of strokes', format: String },
  { key: 'thickness', label: 'Stroke thickness', hint: 'Thicken or thin every line', format: (v) => (v > 0 ? `+${v}` : String(v)) },
  { key: 'smoothing', label: 'Smoothing', hint: 'Higher rounds off corners', format: String },
]

interface Props {
  value: InkAdjust
  onChange: (a: InkAdjust) => void
  /** Prefix for input ids, so several panels can coexist. */
  idPrefix: string
}

export function InkControls({ value, onChange, idPrefix }: Props) {
  return (
    <div className="slider-group">
      {FIELDS.map((f) => (
        <SliderRow
          key={f.key}
          id={`${idPrefix}-${f.key}`}
          label={f.label}
          hint={f.hint}
          {...ADJUST_RANGES[f.key]}
          value={value[f.key]}
          display={f.format(value[f.key])}
          onChange={(v) => onChange({ ...value, [f.key]: v })}
        />
      ))}
    </div>
  )
}
