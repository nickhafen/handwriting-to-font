import { contoursBBox } from '../core/geometry'
import { usable, type GlyphMetrics, type ReviewGlyph } from '../core/project'
import { UNITS } from '../core/template/layout'

/**
 * Does the glyph, with its size and position changes, reach past the
 * template's top or bottom line? Word then adds space between lines.
 */
export function extentProblem(g: ReviewGlyph, m: GlyphMetrics | undefined): 'above' | 'below' | null {
  if (!usable(g)) return null
  const bb = contoursBBox(g.outline)
  if (!bb) return null
  const s = m?.scale ?? 1
  const dy = m?.shiftY ?? 0
  if (bb.yMin * s + dy < UNITS.bottom - 1) return 'below'
  if (bb.yMax * s + dy > UNITS.top + 1) return 'above'
  return null
}

export const extentLabel = (e: 'above' | 'below') => (e === 'below' ? 'past bottom line' : 'past top line')

/** Width of a cell's ink in pixels (0 if blank); exposed on tiles for tests. */
export const inkWidth = (cell: { inkBox: { minX: number; maxX: number } | null } | null | undefined) =>
  cell?.inkBox ? cell.inkBox.maxX - cell.inkBox.minX + 1 : 0
