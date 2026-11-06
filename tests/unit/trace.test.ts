import { describe, expect, it } from 'vitest'
import { buildFont } from '../../src/core/font/build'
import { DEFAULT_SPACING } from '../../src/core/font/metrics'
import { ellipse } from '../../src/core/font/m0TestGlyphs'
import { validateFont } from '../../src/core/font/validate'
import { contoursBBox, type Contour } from '../../src/core/geometry'
import { PX_PER_PT, UNITS, UNITS_PER_PT } from '../../src/core/template/layout'
import { pathToContours, potraceSvgPaths, potraceSvgToUnits, pxToUnits } from '../../src/core/trace/svgToContours'
import { fixWinding, flatten, nestingDepths, polygonArea, reverseContour, windingProblems } from '../../src/core/trace/winding'

// Shaped like real Potrace output: relative commands, coordinates ×10, y flipped by the group transform.
const POTRACE_SVG = `<?xml version="1.0" standalone="no"?><svg version="1.0" xmlns="http://www.w3.org/2000/svg" width="100.000000" height="80.000000" viewBox="0 0 100.000000 80.000000"><g transform="translate(0.000000,80.000000) scale(0.100000,-0.100000)" fill="#000000" stroke="none"><path d="M100 100 l800 0 0 600 -800 0 0 -600z m200 200 l0 200 400 0 0 -200 -400 0z"/></g></svg>`

const square = (x0: number, y0: number, s: number): Contour => ({
  start: { x: x0, y: y0 },
  segments: [
    { type: 'L', to: { x: x0 + s, y: y0 } },
    { type: 'L', to: { x: x0 + s, y: y0 + s } },
    { type: 'L', to: { x: x0, y: y0 + s } },
  ],
})
const area = (c: Contour) => polygonArea(flatten(c))

describe('Potrace SVG -> contours', () => {
  it('applies the group transform and makes commands absolute', () => {
    const paths = potraceSvgPaths(POTRACE_SVG)
    expect(paths).toHaveLength(1)
    const contours = pathToContours(paths[0])
    expect(contours).toHaveLength(2)
    // Outer box: x 10..90, y (image, down) 10..70.
    expect(contoursBBox([contours[0]])).toEqual({ xMin: 10, xMax: 90, yMin: 10, yMax: 70 })
    expect(contoursBBox([contours[1]])).toEqual({ xMin: 30, xMax: 70, yMin: 30, yMax: 50 })
  })

  it('converts curves and maps pixels to font units with the template scale', () => {
    const [c] = pathToContours('M0 0 C10 0 20 10 20 20 Q20 40 0 40 H-10 V0 Z')
    expect(c.segments.map((s) => s.type)).toEqual(['C', 'C', 'L', 'L'])
    const k = UNITS_PER_PT / PX_PER_PT
    const [u] = pxToUnits([c])
    expect(u.start.y).toBeCloseTo(UNITS.top)
    expect(u.segments[0].to.x).toBeCloseTo(20 * k)
    expect(u.segments[0].to.y).toBeCloseTo(UNITS.top - 20 * k)
  })

  it('produces a correctly oriented glyph after fixWinding', () => {
    const contours = fixWinding(potraceSvgToUnits(POTRACE_SVG))
    expect(contours).toHaveLength(2)
    expect(area(contours[0])).toBeGreaterThan(0) // outer: counter-clockwise (y up)
    expect(area(contours[1])).toBeLessThan(0) // hole: clockwise
    expect(windingProblems(contours)).toEqual([])
  })
})

describe('winding', () => {
  it('reverses a contour without changing its shape', () => {
    const c = ellipse(0, 0, 100, 60, true)
    const r = reverseContour(c)
    expect(area(r)).toBeCloseTo(-area(c), 6)
    expect(contoursBBox([r])).toEqual(contoursBBox([c]))
    expect(reverseContour(r)).toEqual(c)
  })

  it('computes nesting depth for an "8"-like shape and a ring inside a ring (like @)', () => {
    const contours = [square(0, 0, 100), square(10, 10, 30), square(10, 60, 30), square(200, 0, 100), square(210, 10, 80), square(230, 30, 40)]
    expect(nestingDepths(contours)).toEqual([0, 1, 1, 0, 1, 2])
  })

  it('orients every contour by depth, whatever direction it came in', () => {
    // All counter-clockwise to start: holes need flipping.
    const fixed = fixWinding([square(0, 0, 100), square(10, 10, 30), square(200, 0, 100), square(210, 10, 80), square(230, 30, 40)])
    expect(fixed.map((c) => Math.sign(area(c)))).toEqual([1, -1, 1, -1, 1])
    // All clockwise to start: outers need flipping.
    const cw = [square(0, 0, 100), square(10, 10, 30)].map(reverseContour)
    expect(fixWinding(cw).map((c) => Math.sign(area(c)))).toEqual([1, -1])
  })

  it('drops zero-area contours', () => {
    const flat: Contour = { start: { x: 0, y: 0 }, segments: [{ type: 'L', to: { x: 10, y: 0 } }] }
    expect(fixWinding([square(0, 0, 50), flat])).toHaveLength(1)
  })
})

describe('validateFont winding check', () => {
  it('catches a hole drawn in the same direction as its outer contour', () => {
    const wrong = [ellipse(220, 240, 220, 250, true), ellipse(220, 240, 135, 165, true)]
    const built = buildFont({ familyName: 'Bad', glyphs: [{ name: 'o', unicode: 111, contours: wrong }], spacing: DEFAULT_SPACING, spaceWidth: 280 })
    const report = validateFont(built.buffer, ['o'])
    expect(report.badWinding).toEqual(['o'])
    expect(report.ok).toBe(false)

    const fixed = buildFont({ familyName: 'Good', glyphs: [{ name: 'o', unicode: 111, contours: fixWinding(wrong) }], spacing: DEFAULT_SPACING, spaceWidth: 280 })
    expect(validateFont(fixed.buffer, ['o']).ok).toBe(true)
  })
})
