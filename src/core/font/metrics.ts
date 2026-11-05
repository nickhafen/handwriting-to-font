import { contoursBBox, translateContours, type Contour } from '../geometry'

export interface SpacingSettings {
  /** Left sidebearing in font units. */
  lsb: number
  /** Right sidebearing in font units. */
  rsb: number
  /** Added to both sidebearings (the global "letter spacing" slider). */
  letterSpacing: number
}

export const DEFAULT_SPACING: SpacingSettings = { lsb: 50, rsb: 50, letterSpacing: 0 }

export interface PlacedGlyph {
  contours: Contour[]
  advanceWidth: number
}

/**
 * Shift a glyph horizontally so its ink starts at the left sidebearing, and
 * set advance width = ink width + both sidebearings. Never moves it vertically:
 * the baseline position comes from where the writer put the ink.
 */
export function placeGlyph(contours: Contour[], spacing: SpacingSettings): PlacedGlyph {
  const left = spacing.lsb + spacing.letterSpacing
  const right = spacing.rsb + spacing.letterSpacing
  const bbox = contoursBBox(contours)
  if (!bbox) return { contours: [], advanceWidth: Math.max(0, Math.round(left + right)) }
  const inkWidth = bbox.xMax - bbox.xMin
  return {
    contours: translateContours(contours, left - bbox.xMin, 0),
    advanceWidth: Math.max(0, Math.round(inkWidth + left + right)),
  }
}
