import { describe, expect, it } from 'vitest'
import { DEFAULT_CELL_SETTINGS, analyzeCell, normalizeCrop, sameCrop, type CropRect } from '../../src/core/scan/cells'
import { grayImage, type GrayImage } from '../../src/core/scan/image'

const W = 280
const H = 230

function fillRect(img: GrayImage, x0: number, y0: number, x1: number, y1: number, v = 20) {
  for (let y = y0; y < y1; y++) img.data.fill(v, y * img.width + x0, y * img.width + x1)
}

/** A "letter" (vertical bar) in the middle of the cell and a stray mark near the right edge. */
function cellWithStray(): GrayImage {
  const img = grayImage(W, H, 240)
  fillRect(img, 130, 60, 145, 170) // letter
  fillRect(img, 250, 100, 258, 130) // stray mark
  return img
}

const KEEP_LETTER: CropRect = { x0: 0.3, y0: 0, x1: 0.7, y1: 1 }

describe('analyzeCell crop', () => {
  it('drops ink outside the crop', () => {
    const full = analyzeCell(cellWithStray(), 0, DEFAULT_CELL_SETTINGS)
    expect(full.inkBox!.maxX).toBeGreaterThanOrEqual(250)

    const cropped = analyzeCell(cellWithStray(), 0, DEFAULT_CELL_SETTINGS, KEEP_LETTER)
    expect(cropped.inkBox).toEqual({ minX: 130, minY: 60, maxX: 144, maxY: 169 })
    expect(cropped.inkArea).toBe(15 * 110)
  })

  it('leaves the kept ink exactly as it was', () => {
    const full = analyzeCell(cellWithStray(), 0, DEFAULT_CELL_SETTINGS)
    const cropped = analyzeCell(cellWithStray(), 0, DEFAULT_CELL_SETTINGS, KEEP_LETTER)
    for (let y = 0; y < H; y++) {
      for (let x = Math.ceil(0.3 * W); x < Math.floor(0.7 * W); x++) expect(cropped.ink[y * W + x]).toBe(full.ink[y * W + x])
    }
  })

  it('keeps the original grayscale so the crop can be changed later', () => {
    const gray = cellWithStray()
    const cropped = analyzeCell(gray, 0, DEFAULT_CELL_SETTINGS, KEEP_LETTER)
    expect(cropped.gray[110 * W + 252]).toBe(20)
  })

  it('does not let thicker strokes grow past the crop edge', () => {
    // The crop cuts right through the letter's right side.
    const keep: CropRect = { x0: 0.3, y0: 0, x1: 140 / W, y1: 1 }
    const r = analyzeCell(cellWithStray(), 0, { ...DEFAULT_CELL_SETTINGS, thickness: 4 }, keep)
    expect(r.inkBox!.maxX).toBe(139)
    expect(r.inkBox!.minX).toBe(126) // grew on the left, inside the crop
  })

  it('treats a crop that removes everything as an empty cell', () => {
    const r = analyzeCell(cellWithStray(), 0, DEFAULT_CELL_SETTINGS, { x0: 0, y0: 0, x1: 0.2, y1: 0.2 })
    expect(r.empty).toBe(true)
    expect(r.inkArea).toBe(0)
  })
})

describe('normalizeCrop', () => {
  it('orders and clamps corners', () => {
    expect(normalizeCrop({ x0: 0.8, y0: 1.2, x1: -0.1, y1: 0.5 })).toEqual({ x0: 0, y0: 0.5, x1: 0.8, y1: 1 })
  })
  it('rejects tiny rectangles (a click, not a drag)', () => {
    expect(normalizeCrop({ x0: 0.5, y0: 0.5, x1: 0.51, y1: 0.9 })).toBeNull()
  })
  it('compares crops by value', () => {
    expect(sameCrop(null, undefined)).toBe(true)
    expect(sameCrop(KEEP_LETTER, { ...KEEP_LETTER })).toBe(true)
    expect(sameCrop(KEEP_LETTER, null)).toBe(false)
    expect(sameCrop(KEEP_LETTER, { ...KEEP_LETTER, x1: 0.71 })).toBe(false)
  })
})
