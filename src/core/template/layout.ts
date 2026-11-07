// SINGLE SOURCE OF TRUTH for template geometry. The PDF generator draws from
// this file and the scan extractor reads from it. Never hard-code geometry
// anywhere else. Changing anything here after printing means bumping
// TEMPLATE_VERSION, because already-printed templates must keep working.
//
// Coordinates use the "canonical frame": origin at the outer top-left corner of
// the top-left marker, x to the right, y DOWN, in PDF points (1/72 in). The
// marker box is the same size on every paper size, so a scan never needs to
// know whether it was printed on Letter or A4.

export const TEMPLATE_VERSION = 1

export const PT_PER_IN = 72
const IN = PT_PER_IN

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Pt {
  x: number
  y: number
}

// ---------------------------------------------------------------- page --------

export type PageSizeId = 'letter' | 'a4'

export const PAGE_SIZES: Record<PageSizeId, { label: string; width: number; height: number }> = {
  letter: { label: 'US Letter (8.5 × 11 in)', width: 8.5 * IN, height: 11 * IN },
  a4: { label: 'A4 (210 × 297 mm)', width: (210 / 25.4) * IN, height: (297 / 25.4) * IN },
}

/** The marker box: fits inside both Letter and A4 with at least 0.5 in margins. */
export const BOX = { width: 7.25 * IN, height: 10 * IN }

/** Where the canonical frame's origin sits on a page (top-left based, y down), centering the box. */
export function boxOriginOnPage(size: PageSizeId): Pt {
  const page = PAGE_SIZES[size]
  return { x: (page.width - BOX.width) / 2, y: (page.height - BOX.height) / 2 }
}

// ------------------------------------------------------------- markers --------

export const MARKER_SIZE = 0.35 * IN
/** White square hole in the top-left marker, used to tell which way is up. */
export const MARKER_HOLE = 0.12 * IN

export type Corner = 'tl' | 'tr' | 'bl' | 'br'

export const MARKERS: Record<Corner, Rect> = {
  tl: { x: 0, y: 0, w: MARKER_SIZE, h: MARKER_SIZE },
  tr: { x: BOX.width - MARKER_SIZE, y: 0, w: MARKER_SIZE, h: MARKER_SIZE },
  bl: { x: 0, y: BOX.height - MARKER_SIZE, w: MARKER_SIZE, h: MARKER_SIZE },
  br: { x: BOX.width - MARKER_SIZE, y: BOX.height - MARKER_SIZE, w: MARKER_SIZE, h: MARKER_SIZE },
}

export const MARKER_HOLE_RECT: Rect = {
  x: (MARKER_SIZE - MARKER_HOLE) / 2,
  y: (MARKER_SIZE - MARKER_HOLE) / 2,
  w: MARKER_HOLE,
  h: MARKER_HOLE,
}

export function rectCenter(r: Rect): Pt {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** Marker centers: the 4 points the homography maps to. */
export const MARKER_CENTERS: Record<Corner, Pt> = {
  tl: rectCenter(MARKERS.tl),
  tr: rectCenter(MARKERS.tr),
  bl: rectCenter(MARKERS.bl),
  br: rectCenter(MARKERS.br),
}

// ------------------------------------------------------------- page ID --------

export const ID_BITS = 8
export const ID_SQUARE = 0.15 * IN
const ID_GAP = 0.1 * IN
const ID_STRIP_WIDTH = ID_BITS * ID_SQUARE + (ID_BITS - 1) * ID_GAP

/** The 8 page-ID squares, left to right (bit 0 first), centered between the top markers. */
export const ID_SQUARES: Rect[] = Array.from({ length: ID_BITS }, (_, i) => ({
  x: (BOX.width - ID_STRIP_WIDTH) / 2 + i * (ID_SQUARE + ID_GAP),
  y: (MARKER_SIZE - ID_SQUARE) / 2,
  w: ID_SQUARE,
  h: ID_SQUARE,
}))

// -------------------------------------------------------------- header --------

/** Text baselines (y, canonical frame) for the two header lines below the marker row. */
export const HEADER = {
  x: 0,
  titleBaseline: 0.6 * IN,
  titleSize: 11,
  noteBaseline: 0.78 * IN,
  noteSize: 9,
}

// ---------------------------------------------------------------- grid --------

export const GRID = {
  cols: 7,
  rows: 8,
  x: 0,
  y: 0.9 * IN,
  width: BOX.width,
  height: 8.6 * IN,
}

export const CELL_W = GRID.width / GRID.cols
export const CELL_H = GRID.height / GRID.rows
export const CELLS_PER_PAGE = GRID.cols * GRID.rows

/** Height of the strip at the top of each cell that shows the target character. */
export const LABEL_H = 0.2 * IN
/** Margin inside the cell border (and below the label strip) that the extractor ignores. */
export const INSET = 0.05 * IN

// ------------------------------------------------- vertical font mapping ------

/**
 * Font units at the edges of the writing area and at each guide line.
 * The writing area's top edge is `top` and its bottom edge is `bottom`;
 * one constant scale maps every cell into font units.
 */
export const UNITS = {
  unitsPerEm: 1000,
  top: 900,
  cap: 700,
  xHeight: 480,
  baseline: 0,
  descender: -250,
  // Extra room below the descender guide so long tails (g, j, p, q, y) don't get clipped.
  bottom: -400,
} as const

/** Resolution of the canonical page image the scanner warps every page to. */
export const CANONICAL_DPI = 300
export const PX_PER_PT = CANONICAL_DPI / PT_PER_IN

export interface CellGeometry {
  index: number
  row: number
  col: number
  /** The whole cell, border to border. */
  cell: Rect
  /** Strip at the top showing the target character (excluded from extraction). */
  label: Rect
  /** The area the extractor crops: below the label strip, minus the inset. Maps to UNITS.top..UNITS.bottom. */
  writing: Rect
  /** Guide-line y positions in the canonical frame. */
  guides: { cap: number; xHeight: number; baseline: number; descender: number }
}

/** Convert a font-unit y value to a canonical-frame y inside a writing rect. */
export function unitsToY(writing: Rect, units: number): number {
  return writing.y + ((UNITS.top - units) / (UNITS.top - UNITS.bottom)) * writing.h
}

/** Font units per point. The same for every cell, by construction. */
export const UNITS_PER_PT = (UNITS.top - UNITS.bottom) / (CELL_H - LABEL_H - 2 * INSET)

export function cellGeometry(index: number): CellGeometry {
  if (index < 0 || index >= CELLS_PER_PAGE) throw new RangeError(`cell index ${index} out of range`)
  return spanCellGeometry(index, Math.floor(index / GRID.cols), index % GRID.cols, 1)
}

/**
 * A box `span` grid columns wide starting at (row, col): used for ligature
 * sheets. Same row height, label strip and inset as a letter cell, so the
 * writing area maps to font units with exactly the same scale.
 */
export function spanCellGeometry(index: number, row: number, col: number, span: number): CellGeometry {
  if (row < 0 || row >= GRID.rows || col < 0 || span < 1 || col + span > GRID.cols) {
    throw new RangeError(`box at row ${row}, col ${col}, span ${span} is outside the grid`)
  }
  const w = span * CELL_W
  const cell: Rect = { x: GRID.x + col * CELL_W, y: GRID.y + row * CELL_H, w, h: CELL_H }
  const label: Rect = { x: cell.x, y: cell.y, w, h: LABEL_H }
  const writing: Rect = {
    x: cell.x + INSET,
    y: cell.y + LABEL_H + INSET,
    w: w - 2 * INSET,
    h: CELL_H - LABEL_H - 2 * INSET,
  }
  return {
    index,
    row,
    col,
    cell,
    label,
    writing,
    guides: {
      cap: unitsToY(writing, UNITS.cap),
      xHeight: unitsToY(writing, UNITS.xHeight),
      baseline: unitsToY(writing, UNITS.baseline),
      descender: unitsToY(writing, UNITS.descender),
    },
  }
}

// -------------------------------------------------------------- colors --------

/** Light "non-photo" blue for borders and guides: drops out when thresholded. */
export const GUIDE_RGB = { r: 0xa4 / 255, g: 0xdd / 255, b: 0xed / 255 }
/** Gray for the label text. Outside the extracted area, so it only needs to be readable. */
export const LABEL_GRAY = 0.45
export const HEADER_GRAY = 0.25
