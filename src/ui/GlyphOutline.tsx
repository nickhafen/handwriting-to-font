import type { Contour } from '../core/geometry'
import { CELL_W, INSET, UNITS, UNITS_PER_PT } from '../core/template/layout'

/** Width of a cell's writing area in font units (contours use the crop's left edge as x = 0). */
const WIDTH = (CELL_W - 2 * INSET) * UNITS_PER_PT
const HEIGHT = UNITS.top - UNITS.bottom

const r = (n: number) => Math.round(n * 10) / 10

/** SVG path data for contours in font units, flipped so y points down. */
export function contoursToPath(contours: Contour[]): string {
  return contours
    .map((c) => {
      const parts = [`M${r(c.start.x)} ${r(-c.start.y)}`]
      for (const s of c.segments) {
        if (s.type === 'L') parts.push(`L${r(s.to.x)} ${r(-s.to.y)}`)
        else parts.push(`C${r(s.c1.x)} ${r(-s.c1.y)} ${r(s.c2.x)} ${r(-s.c2.y)} ${r(s.to.x)} ${r(-s.to.y)}`)
      }
      return parts.join('') + 'Z'
    })
    .join('')
}

/**
 * A traced glyph drawn in its cell's coordinate frame, with baseline and
 * x-height guides. Uses the nonzero fill rule, like font rasterizers do, so a
 * hole with the wrong contour direction would show up filled in.
 */
export function GlyphOutline({ contours, className, shiftY = 0 }: { contours: Contour[]; className?: string; shiftY?: number }) {
  return (
    <svg
      className={className}
      viewBox={`0 ${-UNITS.top} ${r(WIDTH)} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <line x1="0" x2={WIDTH} y1={-UNITS.xHeight} y2={-UNITS.xHeight} className="guide-xheight" />
      <line x1="0" x2={WIDTH} y1={-UNITS.baseline} y2={-UNITS.baseline} className="guide-baseline" />
      <path d={contoursToPath(contours)} fillRule="nonzero" transform={shiftY ? `translate(0 ${-shiftY})` : undefined} />
    </svg>
  )
}
