// Potrace SVG -> absolute contours in font units.
//
// Potrace writes relative path commands inside a transform like
// `translate(0,H) scale(0.1,-0.1)`. svgpath applies that transform and makes
// every command absolute, giving image-pixel coordinates (y down) that we then
// map to font units with the template's single, constant scale.
import svgpath from 'svgpath'
import type { Contour, Point, Segment } from '../geometry'
import { PX_PER_PT, UNITS, UNITS_PER_PT } from '../template/layout'

/** Every <path d="..."> in the SVG, with all enclosing transforms applied (image pixels, y down). */
export function potraceSvgPaths(svg: string): string[] {
  const out: string[] = []
  // Potrace output is flat: an optional <g transform> wrapping <path> elements.
  const groupRe = /<g\b([^>]*)>([\s\S]*?)<\/g>/g
  const transformOf = (attrs: string) => /\btransform="([^"]*)"/.exec(attrs)?.[1] ?? ''
  const pathsIn = (body: string, outer: string) => {
    for (const m of body.matchAll(/<path\b([^>]*?)\/?>/g)) {
      const d = /\bd="([^"]*)"/.exec(m[1])?.[1]
      if (!d) continue
      const t = `${outer} ${transformOf(m[1])}`.trim()
      out.push(svgpath(d).transform(t).abs().unshort().toString())
    }
  }
  let matched = false
  for (const g of svg.matchAll(groupRe)) {
    matched = true
    pathsIn(g[2], transformOf(g[1]))
  }
  if (!matched) pathsIn(svg, '')
  return out
}

/** Split an absolute path string into closed contours. Handles M, L, H, V, C, Q, Z. */
export function pathToContours(d: string): Contour[] {
  const contours: Contour[] = []
  let current: Contour | null = null
  let start: Point = { x: 0, y: 0 }
  svgpath(d)
    .abs()
    .unshort()
    .iterate((seg, _i, x, y) => {
      const cmd = seg[0]
      const push = (s: Segment) => current?.segments.push(s)
      switch (cmd) {
        case 'M':
          start = { x: seg[1], y: seg[2] }
          current = { start, segments: [] }
          contours.push(current)
          break
        case 'L':
          push({ type: 'L', to: { x: seg[1], y: seg[2] } })
          break
        case 'H':
          push({ type: 'L', to: { x: seg[1], y } })
          break
        case 'V':
          push({ type: 'L', to: { x, y: seg[1] } })
          break
        case 'C':
          push({ type: 'C', c1: { x: seg[1], y: seg[2] }, c2: { x: seg[3], y: seg[4] }, to: { x: seg[5], y: seg[6] } })
          break
        case 'Q': {
          // Quadratic -> cubic (exact).
          const q = { x: seg[1], y: seg[2] }
          const to = { x: seg[3], y: seg[4] }
          push({
            type: 'C',
            c1: { x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) },
            c2: { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) },
            to,
          })
          break
        }
        case 'Z':
        case 'z':
          current = null
          break
        default:
          throw new Error(`Unsupported path command ${cmd}`)
      }
    })
  // Drop a closing segment that only returns to the start; contours close implicitly.
  for (const c of contours) {
    const last = c.segments[c.segments.length - 1]
    if (last?.type === 'L' && Math.abs(last.to.x - c.start.x) < 1e-6 && Math.abs(last.to.y - c.start.y) < 1e-6) c.segments.pop()
  }
  return contours.filter((c) => c.segments.length > 0)
}

/** Cell-crop pixels (y down) -> font units (y up, baseline 0) with the constant template scale. */
export function pxToUnits(contours: Contour[]): Contour[] {
  const k = UNITS_PER_PT / PX_PER_PT
  const map = (p: Point): Point => ({ x: p.x * k, y: UNITS.top - p.y * k })
  return contours.map((c) => ({
    start: map(c.start),
    segments: c.segments.map((s) => (s.type === 'L' ? { type: 'L', to: map(s.to) } : { type: 'C', c1: map(s.c1), c2: map(s.c2), to: map(s.to) })),
  }))
}

/** Full conversion: Potrace SVG for one cell -> contours in font units. */
export function potraceSvgToUnits(svg: string): Contour[] {
  return pxToUnits(potraceSvgPaths(svg).flatMap(pathToContours))
}
