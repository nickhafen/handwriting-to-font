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

/** Tight bounding box: on-curve points plus the true extremes of each curve. */
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
    let p = c.start
    for (const s of c.segments) {
      if (s.type === 'C') for (const t of cubicExtremaT(p, s.c1, s.c2, s.to)) add(cubicAt(p, s.c1, s.c2, s.to, t))
      add(s.to)
      p = s.to
    }
  }
  return xMin === Infinity ? null : { xMin, yMin, xMax, yMax }
}

export function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

/** Parameters in (0, 1) where a cubic's x or y derivative is zero (its true extremes). */
function cubicExtremaT(p0: Point, p1: Point, p2: Point, p3: Point): number[] {
  const out: number[] = []
  for (const k of ['x', 'y'] as const) {
    // B'(t)/3 = a t² + b t + c
    const a = -p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]
    const b = 2 * (p0[k] - 2 * p1[k] + p2[k])
    const c = p1[k] - p0[k]
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) > 1e-12) out.push(-c / b)
      continue
    }
    const disc = b * b - 4 * a * c
    if (disc < 0) continue
    const sq = Math.sqrt(disc)
    out.push((-b + sq) / (2 * a), (-b - sq) / (2 * a))
  }
  return out.filter((t) => t > 0 && t < 1)
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
