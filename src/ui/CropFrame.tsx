// Drag a rectangle over a cell image to keep only that part of the cell.
import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { normalizeCrop, type CropRect } from '../core/scan/cells'

interface Props {
  crop: CropRect | null
  onCrop: (crop: CropRect) => void
  disabled?: boolean
  children: ReactNode
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function CropFrame({ crop, onCrop, disabled, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<CropRect | null>(null)

  const at = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }
  const rectTo = (e: PointerEvent): CropRect => {
    const p = at(e)
    const s = start.current!
    return { x0: Math.min(s.x, p.x), y0: Math.min(s.y, p.y), x1: Math.max(s.x, p.x), y1: Math.max(s.y, p.y) }
  }
  const end = () => {
    start.current = null
    setDraft(null)
  }

  const shown = draft ?? crop
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`
  return (
    <div
      ref={ref}
      className={`crop-frame${disabled ? '' : ' active'}`}
      data-testid="crop-frame"
      title={disabled ? undefined : 'Drag to keep only part of the box'}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = at(e)
        setDraft({ x0: start.current.x, y0: start.current.y, x1: start.current.x, y1: start.current.y })
      }}
      onPointerMove={(e) => start.current && setDraft(rectTo(e))}
      onPointerUp={(e) => {
        if (!start.current) return
        const r = normalizeCrop(rectTo(e))
        end()
        // A click (or a tiny drag) leaves the crop as it was.
        if (r) onCrop(r)
      }}
      onPointerCancel={end}
    >
      {children}
      {shown && (
        <div
          className="crop-rect"
          data-testid="crop-rect"
          style={{ left: pct(shown.x0), top: pct(shown.y0), width: pct(shown.x1 - shown.x0), height: pct(shown.y1 - shown.y0) }}
        />
      )}
    </div>
  )
}
