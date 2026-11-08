import { DEFAULT_METRICS, type GlyphMetrics } from '../core/project'
import { SliderRow } from './SliderRow'

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

interface Props {
  value: GlyphMetrics | undefined
  onChange: (m: GlyphMetrics) => void
  idPrefix: string
}

/** Per-character size, position and spacing (font units; the x-height is 480). */
export function PositionControls({ value, onChange, idPrefix }: Props) {
  const v = value ?? DEFAULT_METRICS
  const scale = Math.round((v.scale ?? 1) * 100)
  return (
    <div className="slider-group">
      <SliderRow
        id={`${idPrefix}-scale`}
        label="Size"
        hint="Grow or shrink the character from the baseline"
        min={50}
        max={200}
        step={5}
        value={scale}
        display={`${scale}%`}
        onChange={(n) => onChange({ ...v, scale: n / 100 })}
      />
      <SliderRow
        id={`${idPrefix}-shiftY`}
        label="Move up / down"
        hint="Raise (+) or lower (−) the character; its shape is unchanged"
        min={-250}
        max={250}
        step={10}
        value={v.shiftY}
        display={signed(v.shiftY)}
        onChange={(n) => onChange({ ...v, shiftY: n })}
      />
      <SliderRow
        id={`${idPrefix}-spaceBefore`}
        label="Space before"
        min={-60}
        max={200}
        step={5}
        value={v.spaceBefore}
        display={signed(v.spaceBefore)}
        onChange={(n) => onChange({ ...v, spaceBefore: n })}
      />
      <SliderRow
        id={`${idPrefix}-spaceAfter`}
        label="Space after"
        min={-60}
        max={200}
        step={5}
        value={v.spaceAfter}
        display={signed(v.spaceAfter)}
        onChange={(n) => onChange({ ...v, spaceAfter: n })}
      />
    </div>
  )
}
