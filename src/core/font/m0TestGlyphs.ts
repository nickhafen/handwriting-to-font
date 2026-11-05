// Hard-coded glyphs for the Milestone 0 risk check. They exercise the three
// things most likely to go wrong in Word: holes (o, p), a descender down to
// the bottom of the writing area (p), and an ascender up to the top (l).
import type { Contour, Point } from '../geometry'
import type { GlyphInput } from './build'

/** Cubic-Bezier approximation of a circle quarter. */
const K = 0.5523

/** An ellipse as 4 cubic segments. `ccw` = counter-clockwise in y-up space (outer contour). */
export function ellipse(cx: number, cy: number, rx: number, ry: number, ccw: boolean): Contour {
  const right: Point = { x: cx + rx, y: cy }
  const top: Point = { x: cx, y: cy + ry }
  const left: Point = { x: cx - rx, y: cy }
  const bottom: Point = { x: cx, y: cy - ry }
  if (ccw) {
    return {
      start: right,
      segments: [
        { type: 'C', c1: { x: cx + rx, y: cy + K * ry }, c2: { x: cx + K * rx, y: cy + ry }, to: top },
        { type: 'C', c1: { x: cx - K * rx, y: cy + ry }, c2: { x: cx - rx, y: cy + K * ry }, to: left },
        { type: 'C', c1: { x: cx - rx, y: cy - K * ry }, c2: { x: cx - K * rx, y: cy - ry }, to: bottom },
        { type: 'C', c1: { x: cx + K * rx, y: cy - ry }, c2: { x: cx + rx, y: cy - K * ry }, to: right },
      ],
    }
  }
  return {
    start: right,
    segments: [
      { type: 'C', c1: { x: cx + rx, y: cy - K * ry }, c2: { x: cx + K * rx, y: cy - ry }, to: bottom },
      { type: 'C', c1: { x: cx - K * rx, y: cy - ry }, c2: { x: cx - rx, y: cy - K * ry }, to: left },
      { type: 'C', c1: { x: cx - rx, y: cy + K * ry }, c2: { x: cx - K * rx, y: cy + ry }, to: top },
      { type: 'C', c1: { x: cx + K * rx, y: cy + ry }, c2: { x: cx + rx, y: cy + K * ry }, to: right },
    ],
  }
}

/** Axis-aligned rectangle, counter-clockwise (outer contour). */
function box(x0: number, y0: number, x1: number, y1: number): Contour {
  return {
    start: { x: x0, y: y0 },
    segments: [
      { type: 'L', to: { x: x1, y: y0 } },
      { type: 'L', to: { x: x1, y: y1 } },
      { type: 'L', to: { x: x0, y: y1 } },
    ],
  }
}

/** A ring: outer contour counter-clockwise, hole clockwise (CFF convention). */
function ring(cx: number, cy: number, rx: number, ry: number, stroke: number): Contour[] {
  return [ellipse(cx, cy, rx, ry, true), ellipse(cx, cy, rx - stroke, ry - stroke, false)]
}

export function m0TestGlyphs(): GlyphInput[] {
  return [
    // x-height bowl sitting on the baseline (slight overshoot below 0, like real "o"s).
    { name: 'o', unicode: 'o'.charCodeAt(0), contours: ring(220, 240, 220, 250, 85) },
    // Stem from the descender line (-300) to x-height, plus a bowl with a hole.
    {
      name: 'p',
      unicode: 'p'.charCodeAt(0),
      // Small gap between stem and bowl so no contours overlap (traced glyphs never overlap either).
      contours: [box(0, -300, 85, 480), ...ring(300, 240, 205, 250, 85)],
    },
    // Tall stem reaching the top of the writing area (+900).
    { name: 'l', unicode: 'l'.charCodeAt(0), contours: [box(0, 0, 85, 900)] },
  ]
}
