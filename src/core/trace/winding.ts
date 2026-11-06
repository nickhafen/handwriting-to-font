// Contour direction by nesting depth: outer contours (even depth) run
// counter-clockwise in y-up font space, holes (odd depth) clockwise. That's the
// PostScript/CFF convention, and it makes holes render as holes.
import type { Contour, Point, Segment } from '../geometry'

/** Approximate a contour as a closed polygon (curves sampled `steps` times). */
export function flatten(c: Contour, steps = 8): Point[] {
  const pts: Point[] = [c.start]
  let p = c.start
  for (const s of c.segments) {
    if (s.type === 'L') pts.push(s.to)
    else {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const u = 1 - t
        pts.push({
          x: u * u * u * p.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.to.x,
          y: u * u * u * p.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.to.y,
        })
      }
    }
    p = s.to
  }
  return pts
}

/** Shoelace area; positive = counter-clockwise in y-up space. */
export function polygonArea(pts: Point[]): number {
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/** Even-odd ray casting. */
export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** The same outline traversed the other way. */
export function reverseContour(c: Contour): Contour {
  const segs: Segment[] = [...c.segments]
  const last = segs[segs.length - 1]?.to ?? c.start
  if (last.x !== c.start.x || last.y !== c.start.y) segs.push({ type: 'L', to: c.start })
  // Point i is where segment i starts.
  const starts = [c.start, ...segs.map((s) => s.to)]
  const out: Segment[] = []
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]
    const to = starts[i]
    out.push(s.type === 'L' ? { type: 'L', to } : { type: 'C', c1: s.c2, c2: s.c1, to })
  }
  // Drop the trailing segment that just returns to the start (contours close implicitly).
  const end = out[out.length - 1]
  if (end?.type === 'L' && end.to.x === c.start.x && end.to.y === c.start.y) out.pop()
  return { start: c.start, segments: out }
}

/** How many other contours enclose each contour. */
export function nestingDepths(contours: Contour[]): number[] {
  const polys = contours.map((c) => flatten(c))
  return polys.map((poly, i) => {
    // Potrace contours never cross, so any vertex of this contour tells us what encloses it.
    const probe = poly[0]
    return polys.reduce((n, other, j) => n + (j !== i && pointInPolygon(probe, other) ? 1 : 0), 0)
  })
}

/** Orient every contour by nesting depth; drop degenerate (zero-area) contours. */
export function fixWinding(contours: Contour[], minArea = 1): Contour[] {
  const depths = nestingDepths(contours)
  const out: Contour[] = []
  contours.forEach((c, i) => {
    const area = polygonArea(flatten(c))
    if (Math.abs(area) < minArea) return
    const wantCCW = depths[i] % 2 === 0
    out.push(area > 0 === wantCCW ? c : reverseContour(c))
  })
  return out
}

/** Contours whose direction is wrong for their depth (should be none after fixWinding). */
export function windingProblems(contours: Contour[]): number[] {
  const depths = nestingDepths(contours)
  return contours.flatMap((c, i) => {
    const area = polygonArea(flatten(c))
    return area > 0 === (depths[i] % 2 === 0) ? [] : [i]
  })
}
