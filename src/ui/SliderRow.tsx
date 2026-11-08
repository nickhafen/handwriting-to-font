/** One compact slider line: label, slider, value. The hint shows as a tooltip. */
export function SliderRow(props: {
  id: string
  label: string
  hint?: string
  min: number
  max: number
  step: number
  value: number
  display?: string
  onChange: (v: number) => void
}) {
  const { id, label, hint, min, max, step, value, display, onChange } = props
  return (
    <div className="slider-row" title={hint}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output htmlFor={id}>{display ?? value}</output>
    </div>
  )
}
