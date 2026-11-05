// Project state: which scanned page holds which characters, and the per-glyph review status.
import { suspiciousCells, type CellResult } from './scan/cells'
import type { PageScan } from './scan/processPage'
import { CHARSET, TEMPLATE_PAGES, type CharInfo } from './template/charset'

/** Scans keyed by template page index (0 = letters, 1 = numbers and punctuation). */
export type PagesByIndex = ReadonlyMap<number, PageScan>

export interface ReviewGlyph {
  info: CharInfo
  pageIndex: number
  /** The cell to use for this glyph (its own, or the fallback's). Undefined if the page isn't uploaded. */
  cell?: CellResult
  /** The page this glyph belongs to hasn't been uploaded yet. */
  pageMissing: boolean
  /** Blank, and no fallback available. */
  empty: boolean
  /** Ink touches the edge of the writing area: probably cut off. */
  clipped: boolean
  /** Much more or less ink than similar characters. */
  suspicious: boolean
  /** Blank, so the glyph is copied from `info.fallbackFrom`. */
  usesFallback: boolean
}

/** Where each character lives on the template. */
const LOCATION = new Map<string, { pageIndex: number; cellIndex: number }>()
TEMPLATE_PAGES.forEach((p) => p.cells.forEach((c, i) => c && LOCATION.set(c.char, { pageIndex: p.index, cellIndex: i })))

function cellFor(pages: PagesByIndex, char: string): CellResult | undefined {
  const loc = LOCATION.get(char)
  return loc && pages.get(loc.pageIndex)?.cells[loc.cellIndex]
}

export function assembleGlyphs(pages: PagesByIndex): ReviewGlyph[] {
  const filled = CHARSET.flatMap((info) => {
    const cell = cellFor(pages, info.char)
    return cell && !cell.empty ? [{ info, cell }] : []
  })
  const suspicious = suspiciousCells(filled)

  return CHARSET.map((info) => {
    const { pageIndex } = LOCATION.get(info.char)!
    const own = cellFor(pages, info.char)
    const fallback = info.fallbackFrom ? cellFor(pages, info.fallbackFrom) : undefined
    const usesFallback = !!own?.empty && !!fallback && !fallback.empty
    const cell = usesFallback ? fallback : own
    return {
      info,
      pageIndex,
      cell,
      pageMissing: !own,
      empty: !!own && !!cell?.empty,
      clipped: !!cell && !cell.empty && cell.touchesEdge,
      suspicious: !usesFallback && suspicious.has(info.char),
      usesFallback,
    }
  })
}
