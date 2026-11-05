import { describe, expect, it } from 'vitest'
import { labelComponents, removeSpecks } from '../../src/core/scan/components'
import { findMarkers, ScanError } from '../../src/core/scan/fiducials'
import { apply, invert, multiply, solveHomography, warp } from '../../src/core/scan/homography'
import { grayImage, rgbaToGray, type BinaryImage } from '../../src/core/scan/image'
import { processPage } from '../../src/core/scan/processPage'
import { adaptiveThreshold } from '../../src/core/scan/threshold'
import { photograph, renderPage, type InkSpec } from './helpers/synthPage'

const bin = (rows: string[]): BinaryImage => ({
  width: rows[0].length,
  height: rows.length,
  data: Uint8Array.from(rows.join('').split('').map((c) => (c === '#' ? 1 : 0))),
})

describe('rgbaToGray', () => {
  it('turns the light-blue guide color nearly white and keeps black ink dark', () => {
    const g = rgbaToGray(Uint8Array.from([0xa4, 0xdd, 0xed, 255, 10, 10, 10, 255]), 2, 1)
    expect(Array.from(g.data)).toEqual([237, 10])
  })
})

describe('adaptiveThreshold', () => {
  it('finds dark ink on a strong lighting gradient and drops light guide lines', () => {
    const img = grayImage(200, 200)
    for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) img.data[y * 200 + x] = Math.round(255 - x * 0.6) // 255 -> 135
    for (let x = 0; x < 200; x++) img.data[100 * 200 + x] = Math.round(img.data[100 * 200 + x] * 0.93) // guide line
    for (let y = 40; y < 60; y++) for (let x = 150; x < 170; x++) img.data[y * 200 + x] = 30 // ink in the dark half
    const b = adaptiveThreshold(img, 50, 0.15)
    expect(b.data[50 * 200 + 160]).toBe(1)
    expect(b.data[100 * 200 + 20]).toBe(0)
    expect(b.data[100 * 200 + 180]).toBe(0)
    expect(b.data[20 * 200 + 180]).toBe(0)
  })
})

describe('labelComponents', () => {
  it('labels 8-connected blobs with correct stats', () => {
    const { components } = labelComponents(bin(['##....', '##....', '..#...', '.....#', '....##']))
    expect(components).toHaveLength(2) // the diagonal pixel joins the first blob
    expect(components[0]).toMatchObject({ area: 5, minX: 0, minY: 0, maxX: 2, maxY: 2 })
    expect(components[1]).toMatchObject({ area: 3, minX: 4, maxX: 5 })
  })

  it('removes specks below a size', () => {
    const { image, components } = removeSpecks(bin(['###..#', '###...', '###...']), 2)
    expect(components).toHaveLength(1)
    expect(image.data[5]).toBe(0)
  })
})

describe('homography', () => {
  const src = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 150 },
    { x: 0, y: 150 },
  ]
  const dst = [
    { x: 12, y: 30 },
    { x: 210, y: 18 },
    { x: 230, y: 330 },
    { x: 5, y: 300 },
  ]

  it('maps the 4 source points onto the destination points', () => {
    const H = solveHomography(src, dst)
    src.forEach((p, i) => {
      const q = apply(H, p)
      expect(q.x).toBeCloseTo(dst[i].x, 6)
      expect(q.y).toBeCloseTo(dst[i].y, 6)
    })
  })

  it('inverts', () => {
    const H = solveHomography(src, dst)
    const I = multiply(H, invert(H))
    ;[1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(I[i] / I[8]).toBeCloseTo(v, 9))
    const p = apply(invert(H), apply(H, { x: 37, y: 81 }))
    expect(p.x).toBeCloseTo(37, 6)
    expect(p.y).toBeCloseTo(81, 6)
  })

  it('warps with bilinear sampling', () => {
    const img = grayImage(4, 1)
    img.data.set([0, 100, 200, 250])
    // Shift by half a pixel: output x samples source x + 0.5.
    const out = warp(img, Float64Array.from([1, 0, 0.5, 0, 1, 0, 0, 0, 1]), 3, 1)
    expect(Array.from(out.data)).toEqual([50, 150, 225])
  })
})

describe('processPage on synthetic photos', () => {
  // "x": sits on the baseline, top at x-height. "g": x-height down to a deep tail. "l": tall.
  const inks: InkSpec[] = [
    { cell: 0, top: 480, bottom: 0 },
    { cell: 1, top: 480, bottom: -330 },
    { cell: 2, top: 750, bottom: 0 },
    { cell: 3, top: 300, bottom: -420 }, // runs off the bottom: should be flagged as clipped
  ]
  const page = renderPage(1, 150, inks)

  const cases = [
    { name: 'flat scan', opts: {} },
    { name: 'tilted photo with perspective, shading and noise', opts: { rotate: 5, skew: 0.03, shade: 0.55, noise: 18, seed: 3 } },
    { name: 'upside down', opts: { rotate: 180 - 3, skew: 0.015, shade: 0.8, noise: 8, seed: 4 } },
    { name: 'sideways', opts: { rotate: 90, noise: 6, seed: 5 } },
    { name: 'tilted the other way', opts: { rotate: -5, skew: 0.02, seed: 6 } },
  ]

  it.each(cases)('$name', ({ opts }) => {
    const result = processPage(photograph(page, opts))
    expect(result.pageId).toEqual({ version: 1, pageIndex: 1 })
    expect(result.idConfidence).toBeGreaterThan(0.5)
    const [x, g, l, clipped] = result.cells
    const tol = 30 // font units (~3 px at 150 DPI)
    expect(x.empty).toBe(false)
    expect(Math.abs(x.yMinUnits!)).toBeLessThan(tol)
    expect(Math.abs(x.yMaxUnits! - 480)).toBeLessThan(tol)
    expect(Math.abs(g.yMinUnits! + 330)).toBeLessThan(tol)
    expect(Math.abs(l.yMaxUnits! - 750)).toBeLessThan(tol)
    expect(x.touchesEdge || g.touchesEdge || l.touchesEdge).toBe(false)
    expect(clipped.touchesEdge).toBe(true)
    // Every other cell is blank: the light guides must not count as ink.
    expect(result.cells.slice(4).filter((c) => !c.empty).map((c) => c.index)).toEqual([])
  })

  it('explains what went wrong when the corner squares are missing', () => {
    expect(() => findMarkers(grayImage(800, 1000))).toThrow(ScanError)
  })
})
