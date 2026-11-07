// Crop each cell's writing area from the canonical page, threshold it, clean it, and flag problems.
import type { Contour } from '../geometry'
import type { CharInfo } from '../template/charset'
import { CELLS_PER_PAGE, PX_PER_PT, UNITS, UNITS_PER_PT, cellGeometry, type CellGeometry } from '../template/layout'
import { removeSpecks } from './components'
import { crop, percentile, type GrayImage } from './image'
import { adjustThickness, detectGuideRows, hysteresis, normalizeBackground } from './inkMask'

export interface CellSettings {
  /** Definitely ink: darker than this fraction of the cell's paper brightness. */
  inkRatio: number
  /** Faint ink: darker than this fraction, and connected to definite ink (hysteresis). */
  weakRatio: number
  /** Within a few pixels of a printed guide line, faint ink must be darker than this, so it can't follow the line. */
  guideRatio: number
  /** Ink blobs smaller than this many pixels (at 300 DPI) are removed as specks. */
  speckArea: number
  /** A cell with less ink than this (pixels) counts as empty. */
  minInkArea: number
  /** Pixels to thicken (+) or thin (−) every stroke on each side. */
  thickness: number
}

export const DEFAULT_CELL_SETTINGS: CellSettings = {
  inkRatio: 0.6,
  weakRatio: 0.8,
  guideRatio: 0.7,
  speckArea: 12,
  minInkArea: 40,
  thickness: 0,
}

/** Half-height (pixels) of the band around each printed guide line where `guideRatio` applies. */
const GUIDE_BAND = 4

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

/** Font-unit height -> pixel row in a writing-area crop. */
const unitsToRow = (u: number) => ((UNITS.top - u) / UNITS_PER_PT) * PX_PER_PT

/** Rows near the printed guide lines (cap, x-height, baseline, descender) in a crop of height `h`. */
function guideBandRows(h: number): boolean[] {
  const rows = new Array<boolean>(h).fill(false)
  for (const u of [UNITS.cap, UNITS.xHeight, UNITS.baseline, UNITS.descender]) {
    const c = Math.round(unitsToRow(u))
    for (let y = c - GUIDE_BAND; y <= c + GUIDE_BAND; y++) if (y >= 0 && y < h) rows[y] = true
  }
  return rows
}

export function extractCell(canonical: GrayImage, index: number, settings: CellSettings): CellResult {
  return extractBox(canonical, cellGeometry(index), settings)
}

/** Crop and analyze any box (a letter cell or a wider ligature box). */
export function extractBox(canonical: GrayImage, geometry: CellGeometry, settings: CellSettings): CellResult {
  const index = geometry.index
  const r = geometry.writing
  const x0 = Math.round(r.x * PX_PER_PT)
  const y0 = Math.round(r.y * PX_PER_PT)
  const w = Math.round(r.w * PX_PER_PT)
  const h = Math.round(r.h * PX_PER_PT)
  return analyzeCell(crop(canonical, x0, y0, w, h), index, settings)
}

/** Threshold, clean and measure one cell's grayscale writing-area crop. */
export function analyzeCell(gray: GrayImage, index: number, settings: CellSettings): CellResult {
  const { width: w, height: h } = gray
  // Even out shadows first, so "faint" means faint ink, not shaded paper.
  const flat = normalizeBackground(gray)
  // Paper level from a high percentile: most of a cell is blank paper.
  const paper = percentile(flat, 0.95)
  const strongCut = paper * settings.inkRatio
  const weakCut = paper * Math.max(settings.inkRatio, settings.weakRatio)
  // Guard the expected guide rows, plus any row that actually looks like a printed line.
  const expected = guideBandRows(h)
  const found = detectGuideRows(flat, strongCut, weakCut)
  const binary = hysteresis(flat, {
    strongCut,
    weakCut,
    bandCut: paper * Math.max(settings.inkRatio, settings.guideRatio),
    bandRows: expected.map((v, y) => v || found[y]),
  })
  const { image: cleaned } = removeSpecks(binary, settings.speckArea)
  const ink = adjustThickness(cleaned, settings.thickness)

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
