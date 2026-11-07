// Ligature sheets: boxes 1–3 grid cells wide on the standard page frame.
// Page-ID page indices 8–15 are ligature sheets: 8 is the pre-labeled
// "common" sheet, 9–15 are blank sheets 1–7 (each its own page, so several
// blank sheets can be filled independently). Letter pages (0–7) are unchanged.
import { CHARSET } from './charset'
import { GRID, spanCellGeometry, type CellGeometry } from './layout'

export const LIGATURE_PAGE_BASE = 8
export const COMMON_SHEET = 0
export const BLANK_SHEETS = 7

export function ligatureSheetOf(pageIndex: number): number | null {
  const s = pageIndex - LIGATURE_PAGE_BASE
  return s >= 0 && s <= BLANK_SHEETS ? s : null
}

export const pageIndexOfLigatureSheet = (sheet: number) => LIGATURE_PAGE_BASE + sheet

export const ligatureSheetName = (sheet: number) => (sheet === COMMON_SHEET ? 'Common ligatures sheet' : `Blank ligature sheet ${sheet}`)

export interface LigatureBox {
  /** Box number on the sheet (0-based; printed 1-based). */
  index: number
  row: number
  col: number
  span: number
  /** Pre-printed text on the common sheet. */
  preset?: string
}

/** Common sheet, row by row. Three-letter sequences get 3-cell boxes, pairs get 2. */
const COMMON_ROWS: string[][] = [
  ['ffi', 'ff', 'fi'],
  ['ffl', 'fl', 'ft'],
  ['ing', 'in', 'on'],
  ['tt', 'th', 'ch'],
  ['sh', 'wh', 'ck'],
  ['qu', 'st', 'ss'],
  ['ll', 'oo', 'ee'],
  ['er', 'or', 'ou'],
]

export const COMMON_LIGATURES = COMMON_ROWS.flat()

/** Blank sheet rows as box widths: singles (for alternate forms), then pairs, then triples. */
const BLANK_ROWS: number[][] = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1],
  [2, 2, 2, 1],
  [2, 2, 2, 1],
  [2, 2, 2, 1],
  [3, 3, 1],
  [3, 3, 1],
  [3, 3, 1],
]

function layoutRows(rows: { span: number; preset?: string }[][]): LigatureBox[] {
  const boxes: LigatureBox[] = []
  rows.forEach((row, r) => {
    let col = 0
    for (const b of row) {
      boxes.push({ index: boxes.length, row: r, col, span: b.span, ...(b.preset && { preset: b.preset }) })
      col += b.span
    }
    if (col > GRID.cols) throw new Error(`Ligature row ${r} is too wide`)
  })
  return boxes
}

const COMMON_BOXES = layoutRows(COMMON_ROWS.map((row) => row.map((t) => ({ span: t.length, preset: t }))))
const BLANK_BOXES = layoutRows(BLANK_ROWS.map((row) => row.map((span) => ({ span }))))

export const ligatureBoxes = (sheet: number): LigatureBox[] => (sheet === COMMON_SHEET ? COMMON_BOXES : BLANK_BOXES)

export const ligatureBoxGeometry = (b: LigatureBox): CellGeometry => spanCellGeometry(b.index, b.row, b.col, b.span)

// ------------------------------------------------------------ box text ------

const KNOWN = new Map(CHARSET.map((c) => [c.char, c]))

export type ParsedLigature =
  | { kind: 'none' }
  | { kind: 'ligature'; chars: string[] }
  | { kind: 'alternate'; before: string[]; target: string; after: string[] }
  | { kind: 'error'; message: string }

/**
 * What a box holds, from the text typed for it:
 * - "th"   → a ligature: the sequence t, h is drawn as this one shape.
 * - "r[e]" → a contextual alternate: this box is an "e", used after "r".
 *            "[o]n" is an "o" used before "n"; "o[n]e" needs both.
 */
export function parseLigatureText(text: string): ParsedLigature {
  const t = text.trim()
  if (!t) return { kind: 'none' }
  const chars = (s: string) => [...s]
  const unknown = chars(t.replace(/[[\]]/g, '')).filter((c) => !KNOWN.has(c))
  if (unknown.length) return { kind: 'error', message: `Not in the font: ${[...new Set(unknown)].map((c) => (c === ' ' ? 'space' : c)).join(' ')}` }
  const m = /^([^[\]]*)\[([^[\]]+)\]([^[\]]*)$/.exec(t)
  if (m) {
    const target = chars(m[2])
    if (target.length !== 1) return { kind: 'error', message: 'Put exactly one character in the brackets, e.g. r[e]' }
    if (!m[1] && !m[3]) return { kind: 'error', message: 'Add a letter before or after the brackets, e.g. r[e] or [o]n' }
    return { kind: 'alternate', before: chars(m[1]), target: target[0], after: chars(m[3]) }
  }
  if (/[[\]]/.test(t)) return { kind: 'error', message: 'Use one pair of brackets around the drawn letter, e.g. r[e]' }
  if (chars(t).length < 2) return { kind: 'error', message: 'A ligature needs 2 or more characters. For another form of one letter, add context: r[e]' }
  return { kind: 'ligature', chars: chars(t) }
}

/** AGL-style glyph name for a ligature, e.g. "f_f_i", "t_h". */
export const ligatureGlyphName = (chars: string[]) => chars.map((c) => KNOWN.get(c)!.glyphName).join('_')

export const glyphNameOf = (char: string) => KNOWN.get(char)!.glyphName
