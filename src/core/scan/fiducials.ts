// Find the four corner markers and work out which way is up.
import type { Corner } from '../template/layout'
import { labelComponents, principalVariances, type Component } from './components'
import type { Point2 } from './homography'
import { downscale, type GrayImage } from './image'
import { adaptiveThreshold } from './threshold'

export class ScanError extends Error {
  readonly tips: string[]
  constructor(message: string, tips: string[] = []) {
    super(message)
    this.name = 'ScanError'
    this.tips = tips
  }
}

const PHOTO_TIPS = [
  'Make sure all four black corner squares are in the picture, with some paper around them.',
  'Lay the page flat and use even light without strong shadows or glare.',
  'Print at 100% / Actual size and avoid cropping the scan.',
]

export interface MarkerSettings {
  /** Detection runs on a copy shrunk so its longest side is about this many pixels. */
  detectSize: number
  /** Max ratio of the long to short side (orientation-independent). */
  maxAspect: number
  /** Min ink area ÷ convex-hull area. The hollow marker is about 0.88. */
  minSolidity: number
  /** Marker side as a fraction of the image's shorter side. */
  minSideFrac: number
  maxSideFrac: number
}

export const DEFAULT_MARKER_SETTINGS: MarkerSettings = {
  detectSize: 1600,
  maxAspect: 1.3,
  minSolidity: 0.8,
  minSideFrac: 0.006,
  maxSideFrac: 0.15,
}

export interface MarkerResult {
  /** Marker centers in full-resolution image coordinates (pixel centers at +0.5). */
  corners: Record<Corner, Point2>
  /** Approximate marker side length in full-resolution pixels. */
  markerSide: number
}

/** Convex-hull area of a component, built from each row's leftmost and rightmost pixel corners. */
function hullArea(labels: Int32Array, width: number, c: Component): number {
  const pts: [number, number][] = []
  for (let y = c.minY; y <= c.maxY; y++) {
    let lo = -1
    let hi = -1
    for (let x = c.minX; x <= c.maxX; x++) {
      if (labels[y * width + x] === c.label) {
        if (lo < 0) lo = x
        hi = x
      }
    }
    if (lo >= 0) pts.push([lo, y], [lo, y + 1], [hi + 1, y], [hi + 1, y + 1])
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  let area = 0
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i]
    const [x2, y2] = hull[(i + 1) % hull.length]
    area += x1 * y2 - x2 * y1
  }
  return Math.abs(area) / 2
}

/** True if the middle of the component is mostly paper (the top-left marker's hole). */
function isHollow(labels: Int32Array, width: number, c: Component): boolean {
  const r = 0.12 * Math.min(c.maxX - c.minX + 1, c.maxY - c.minY + 1)
  const x0 = Math.round(c.cx - r)
  const x1 = Math.round(c.cx + r)
  const y0 = Math.round(c.cy - r)
  const y1 = Math.round(c.cy + r)
  let paper = 0
  let total = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      total++
      if (labels[y * width + x] !== c.label) paper++
    }
  }
  return total > 0 && paper / total > 0.5
}

export function findMarkers(gray: GrayImage, settings: MarkerSettings = DEFAULT_MARKER_SETTINGS): MarkerResult {
  const k = Math.max(1, Math.floor(Math.max(gray.width, gray.height) / settings.detectSize))
  const small = downscale(gray, k)
  const { width: w, height: h } = small
  const minSide = Math.min(w, h)
  const window = Math.max(15, Math.round(minSide / 8))
  const binary = adaptiveThreshold(small, window, 0.15)
  const { labels, components } = labelComponents(binary)

  const minA = (settings.minSideFrac * minSide) ** 2
  const maxA = (settings.maxSideFrac * minSide) ** 2
  const candidates = components.filter((c) => {
    if (c.area < minA || c.area > maxA) return false
    if (c.minX === 0 || c.minY === 0 || c.maxX === w - 1 || c.maxY === h - 1) return false
    const [l1, l2] = principalVariances(c)
    if (l2 <= 0 || Math.sqrt(l1 / l2) > settings.maxAspect) return false
    return c.area / hullArea(labels, w, c) >= settings.minSolidity
  })

  // In each quadrant, the candidate farthest from the image center: the markers
  // are the outermost marks on the page, while a filled-in letter or dot that
  // passes the shape test sits further in.
  const quads: (Component | undefined)[] = [undefined, undefined, undefined, undefined]
  const dist = (c: Component) => Math.hypot(c.cx - w / 2, c.cy - h / 2)
  for (const c of candidates) {
    const q = (c.cx < w / 2 ? 0 : 1) + (c.cy < h / 2 ? 0 : 2)
    if (!quads[q] || dist(c) > dist(quads[q]!)) quads[q] = c
  }
  const found = quads.filter((c): c is Component => !!c)
  if (found.length < 4) {
    throw new ScanError(`Found ${found.length} of the 4 black corner squares.`, PHOTO_TIPS)
  }
  const areas = found.map((c) => c.area)
  if (Math.max(...areas) / Math.min(...areas) > 4) {
    throw new ScanError('The corner squares found are very different sizes, so they may not be the real markers.', PHOTO_TIPS)
  }

  const hollow = found.filter((c) => isHollow(labels, w, c))
  if (hollow.length !== 1) {
    throw new ScanError(
      hollow.length === 0
        ? "Couldn't find the top-left corner square (the one with a white hole), so the page's orientation is unknown."
        : 'More than one corner square looks hollow, so the page orientation is unclear.',
      ['Use a sharper scan or photo; the hole in the top-left square must be visible.', ...PHOTO_TIPS],
    )
  }

  // Order clockwise on screen (y points down) starting from the hollow top-left marker.
  const mx = found.reduce((s, c) => s + c.cx, 0) / 4
  const my = found.reduce((s, c) => s + c.cy, 0) / 4
  const ordered = [...found].sort((a, b) => Math.atan2(a.cy - my, a.cx - mx) - Math.atan2(b.cy - my, b.cx - mx))
  const start = ordered.indexOf(hollow[0])
  const [tl, tr, br, bl] = [0, 1, 2, 3].map((i) => ordered[(start + i) % 4])

  // Small-image centroid (pixel centers at +0.5) -> full-resolution coordinates.
  const full = (c: Component): Point2 => ({ x: (c.cx + 0.5) * k, y: (c.cy + 0.5) * k })
  return {
    corners: { tl: full(tl), tr: full(tr), br: full(br), bl: full(bl) },
    markerSide: Math.sqrt(areas.reduce((s, a) => s + a, 0) / 4) * k,
  }
}
