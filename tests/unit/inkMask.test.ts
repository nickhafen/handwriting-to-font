import { describe, expect, it } from 'vitest'
import { DEFAULT_ADJUST, toCellSettings } from '../../src/core/scan/adjust'
import { analyzeCell, DEFAULT_CELL_SETTINGS } from '../../src/core/scan/cells'
import { grayImage, type BinaryImage, type GrayImage } from '../../src/core/scan/image'
import { adjustThickness, hysteresis } from '../../src/core/scan/inkMask'
import { DEFAULT_MARKER_SETTINGS } from '../../src/core/scan/fiducials'
import { processPage } from '../../src/core/scan/processPage'
import { photograph, renderPage } from './helpers/synthPage'

const count = (b: BinaryImage) => b.data.reduce((s, v) => s + v, 0)

function paint(img: GrayImage, x0: number, y0: number, x1: number, y1: number, v: number) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data[y * img.width + x] = v
}

describe('hysteresis', () => {
  // Paper 255. A dark stroke continues as a faint (170) stroke; a separate faint smudge stands alone.
  const img = grayImage(60, 40)
  paint(img, 5, 10, 25, 14, 30) // dark
  paint(img, 25, 10, 45, 14, 170) // faint continuation
  paint(img, 50, 30, 56, 36, 170) // isolated faint smudge

  it('keeps faint ink that connects to dark ink, and drops isolated faint ink', () => {
    const m = hysteresis(img, { strongCut: 153, weakCut: 204 })
    expect(m.data[12 * 60 + 40]).toBe(1)
    expect(m.data[33 * 60 + 53]).toBe(0)
    expect(count(m)).toBe(40 * 4)
  })

  it('behaves like a plain threshold when the weak cutoff equals the strong one', () => {
    expect(count(hysteresis(img, { strongCut: 153, weakCut: 153 }))).toBe(20 * 4)
  })

  it('stops faint growth inside guide bands', () => {
    const rows = Array.from({ length: 40 }, (_, y) => y >= 10 && y < 14)
    const m = hysteresis(img, { strongCut: 153, weakCut: 204, bandCut: 160, bandRows: rows })
    expect(m.data[12 * 60 + 40]).toBe(0)
  })
})

describe('adjustThickness', () => {
  const line: BinaryImage = { width: 40, height: 40, data: new Uint8Array(1600) }
  for (let y = 10; y < 30; y++) for (let x = 18; x < 22; x++) line.data[y * 40 + x] = 1 // 4 px wide

  const widthAt = (b: BinaryImage, y: number) => Array.from({ length: 40 }, (_, x) => b.data[y * 40 + x]).reduce((s, v) => s + v, 0)

  it('returns the same mask for 0', () => {
    expect(adjustThickness(line, 0)).toBe(line)
  })

  it('thickens by about the amount on each side', () => {
    expect(widthAt(adjustThickness(line, 2), 20)).toBe(8)
  })

  it('thins by about the amount on each side', () => {
    expect(widthAt(adjustThickness(line, -1), 20)).toBe(2)
    expect(count(adjustThickness(line, -2))).toBe(0)
  })
})

describe('faint strokes through the full pipeline', () => {
  // Cell 0: a dark x-height bar sitting on a faint (gray 175) stem that reaches the baseline.
  const page = renderPage(0, 150, [
    { cell: 0, top: 480, bottom: 300 },
    { cell: 0, top: 300, bottom: 0, gray: 175, x0: 0.45, x1: 0.55 },
  ])
  const photo = photograph(page, { rotate: 3, skew: 0.01, shade: 0.8, noise: 6, seed: 9 })

  it('keeps the faint part by default', () => {
    const [cell] = processPage(photo).cells
    expect(Math.abs(cell.yMinUnits!)).toBeLessThan(30)
  })

  it('drops the faint part at the lowest sensitivity (the old behavior)', () => {
    const settings = toCellSettings({ ...DEFAULT_ADJUST, sensitivity: 0 })
    const [cell] = processPage(photo, { markers: DEFAULT_MARKER_SETTINGS, cells: settings }).cells
    expect(cell.yMinUnits!).toBeGreaterThan(250)
  })

  it('leaves every blank cell blank at the highest sensitivity (guides stay out)', () => {
    const settings = toCellSettings({ ...DEFAULT_ADJUST, sensitivity: 100 })
    const r = processPage(photo, { markers: DEFAULT_MARKER_SETTINGS, cells: settings })
    expect(r.cells.slice(1).filter((c) => !c.empty).map((c) => c.index)).toEqual([])
  })
})

describe('dark guide lines from a grayscale print', () => {
  // A cell-sized crop: paper 235, a gray halftone-ish baseline (~0.62 × paper, as dark as on the
  // user's grayscale scan) a few pixels off its expected row, and two dark "n" legs standing on it.
  const W = 281
  const H = 232
  const LINE = 168
  const cell = () => {
    const img = grayImage(W, H, 235)
    for (let y = LINE; y < LINE + 4; y++) for (let x = 0; x < W; x++) img.data[y * W + x] = (x + y) % 2 ? 136 : 156
    paint(img, 100, 80, 108, LINE + 2, 50)
    paint(img, 160, 80, 168, LINE + 2, 50)
    return img
  }
  const at = (m: Uint8Array, x: number, y: number) => m[y * W + x]

  it('keeps the legs and drops the line', () => {
    const r = analyzeCell(cell(), 0, DEFAULT_CELL_SETTINGS)
    expect(at(r.ink, 104, 120)).toBe(1)
    expect(at(r.ink, 164, 120)).toBe(1)
    for (const x of [20, 60, 134, 220, 260]) expect(at(r.ink, x, LINE + 1)).toBe(0)
    // Nothing but the two legs: about 2 × 8 px wide.
    expect(r.inkBox!.maxX - r.inkBox!.minX).toBeLessThan(80)
  })

  it('without the line ceiling, the line would be traced (the old behavior)', () => {
    const r = analyzeCell(cell(), 0, { ...DEFAULT_CELL_SETTINGS, guideMargin: -1000 })
    expect(r.inkBox!.maxX - r.inkBox!.minX).toBeGreaterThan(200)
  })
})
