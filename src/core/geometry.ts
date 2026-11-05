// Shared outline types, in font units (y points up, baseline at y = 0).

export interface Point {
  x: number
  y: number
}

export type Segment =
  | { type: 'L'; to: Point }
  | { type: 'C'; c1: Point; c2: Point; to: Point }

/** A closed outline: start at `start`, follow `segments`, and close back to `start`. */
export interface Contour {
  start: Point
  segments: Segment[]
}

export interface BBox {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

/** Bounding box of all on-curve and control points (a safe over-estimate for curves). */
export function contoursBBox(contours: Contour[]): BBox | null {
  let xMin = Infinity
  let yMin = Infinity
  let xMax = -Infinity
  let yMax = -Infinity
  const add = (p: Point) => {
    if (p.x < xMin) xMin = p.x
    if (p.x > xMax) xMax = p.x
    if (p.y < yMin) yMin = p.y
    if (p.y > yMax) yMax = p.y
  }
  for (const c of contours) {
    add(c.start)
    for (const s of c.segments) {
      if (s.type === 'C') {
        add(s.c1)
        add(s.c2)
      }
      add(s.to)
    }
  }
  return xMin === Infinity ? null : { xMin, yMin, xMax, yMax }
}

export function translateContours(contours: Contour[], dx: number, dy: number): Contour[] {
  const t = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy })
  return contours.map((c) => ({
    start: t(c.start),
    segments: c.segments.map((s) =>
      s.type === 'L' ? { type: 'L', to: t(s.to) } : { type: 'C', c1: t(s.c1), c2: t(s.c2), to: t(s.to) },
    ),
  }))
}

/**
 * Signed area of the contour's control polygon (shoelace formula).
 * Positive = counter-clockwise in y-up space. Good enough to tell direction
 * for the smooth, non-self-intersecting outlines we produce.
 */
export function signedArea(contour: Contour): number {
  const pts: Point[] = [contour.start]
  for (const s of contour.segments) {
    if (s.type === 'C') pts.push(s.c1, s.c2)
    pts.push(s.to)
  }
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}
