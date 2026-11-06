// Crop each cell's writing area from the canonical page, threshold it, clean it, and flag problems.
import type { Contour } from '../geometry'
import type { CharInfo } from '../template/charset'
import { CELLS_PER_PAGE, PX_PER_PT, UNITS, UNITS_PER_PT, cellGeometry } from '../template/layout'
import { removeSpecks } from './components'
import { crop, percentile, type GrayImage } from './image'
import { globalThreshold } from './threshold'

export interface CellSettings {
  /** Ink is darker than this fraction of the cell's paper brightness. */
  inkRatio: number
  /** Ink blobs smaller than this many pixels (at 300 DPI) are removed as specks. */
  speckArea: number
  /** A cell with less ink than this (pixels) counts as empty. */
  minInkArea: number
}

export const DEFAULT_CELL_SETTINGS: CellSettings = { inkRatio: 0.6, speckArea: 12, minInkArea: 40 }

export interface InkBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface CellResult {
  /** Grid position on the page, 0..55. */
  index: number
  width: number
  height: number
  /** Original grayscale crop of the writing area. */
  gray: Uint8Array
  /** Cleaned ink mask (1 = ink). */
  ink: Uint8Array
  inkArea: number
  inkBox: InkBox | null
  /** Top and bottom of the ink in font units (baseline = 0), or null if empty. */
  yMaxUnits: number | null
  yMinUnits: number | null
  empty: boolean
  /** Ink reaches the edge of the crop, so the character is probably cut off. */
  touchesEdge: boolean
  /** Traced outlines in font units (filled in by the tracing step; empty until then). */
  contours: Contour[]
}

/** Canonical-image pixel row (top edge of the row) inside a writing area -> font units. */
export function rowToUnits(row: number): number {
  return UNITS.top - (row / PX_PER_PT) * UNITS_PER_PT
}

export function extractCell(canonical: GrayImage, index: number, settings: CellSettings): CellResult {
  const r = cellGeometry(index).writing
  const x0 = Math.round(r.x * PX_PER_PT)
  const y0 = Math.round(r.y * PX_PER_PT)
  const w = Math.round(r.w * PX_PER_PT)
  const h = Math.round(r.h * PX_PER_PT)
  const gray = crop(canonical, x0, y0, w, h)

  // Paper level from a high percentile: most of a cell is blank paper.
  const paper = percentile(gray, 0.95)
  const binary = globalThreshold(gray, paper * settings.inkRatio)
  const { image: ink } = removeSpecks(binary, settings.speckArea)

  let inkArea = 0
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  let touchesEdge = false
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink.data[y * w + x]) continue
      inkArea++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true
    }
  }
  const empty = inkArea < settings.minInkArea
  const inkBox = inkArea > 0 ? { minX, minY, maxX, maxY } : null
  return {
    index,
    width: w,
    height: h,
    gray: gray.data,
    ink: ink.data,
    inkArea,
    inkBox,
    yMaxUnits: inkBox && !empty ? rowToUnits(minY) : null,
    yMinUnits: inkBox && !empty ? rowToUnits(maxY + 1) : null,
    empty,
    touchesEdge: !empty && touchesEdge,
    contours: [],
  }
}

export function extractAllCells(canonical: GrayImage, settings: CellSettings = DEFAULT_CELL_SETTINGS): CellResult[] {
  return Array.from({ length: CELLS_PER_PAGE }, (_, i) => extractCell(canonical, i, settings))
}

/**
 * Flag cells whose ink area is far from the median of comparable cells:
 * letters and digits are compared with each other; punctuation is only
 * flagged for being too large (a period is legitimately tiny).
 */
export function suspiciousCells(cells: { info: CharInfo; cell: CellResult }[]): Set<string> {
  const isAlnum = (c: CharInfo) => /^[A-Za-z0-9]$/.test(c.char)
  const areas = cells.filter((c) => !c.cell.empty && isAlnum(c.info)).map((c) => c.cell.inkArea).sort((a, b) => a - b)
  const out = new Set<string>()
  if (areas.length < 5) return out
  const median = areas[Math.floor(areas.length / 2)]
  for (const { info, cell } of cells) {
    if (cell.empty) continue
    if (cell.inkArea > 4 * median) out.add(info.char)
    else if (isAlnum(info) && cell.inkArea < 0.12 * median) out.add(info.char)
  }
  return out
}
