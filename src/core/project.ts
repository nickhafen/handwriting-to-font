// Project state: which scanned page holds which characters, and the per-glyph review status.
import { buildFont, type BuiltFont, type GlyphInput } from './font/build'
import { DEFAULT_SPACING } from './font/metrics'
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

// ------------------------------------------------------------- font build -----

export interface FontSettings {
  /** Family name before any build suffix. */
  familyName: string
  /** Append a short build code on export so Windows doesn't show a cached older install. */
  addBuildSuffix: boolean
  /** Font units added to each side of every glyph (on top of the default 50). */
  letterSpacing: number
  /** Width of the space character in font units. */
  wordSpacing: number
}

export const DEFAULT_FONT_SETTINGS: FontSettings = {
  familyName: 'My Handwriting',
  addBuildSuffix: true,
  letterSpacing: 0,
  wordSpacing: 280,
}

/** Glyphs that have traced outlines, ready for the font builder. Fallbacks reuse the source outlines. */
export function glyphInputs(glyphs: ReviewGlyph[]): GlyphInput[] {
  return glyphs.flatMap((g) =>
    g.cell && !g.empty && g.cell.contours.length > 0
      ? [{ name: g.info.glyphName, unicode: g.info.unicode, contours: g.cell.contours }]
      : [],
  )
}

/** Build the font for the current glyphs and settings. `suffix` is added to the family name if given. */
export function buildProjectFont(glyphs: ReviewGlyph[], settings: FontSettings, suffix?: string): BuiltFont {
  const base = settings.familyName.trim() || DEFAULT_FONT_SETTINGS.familyName
  return buildFont({
    familyName: suffix ? `${base} ${suffix}` : base,
    glyphs: glyphInputs(glyphs),
    spacing: { ...DEFAULT_SPACING, letterSpacing: settings.letterSpacing },
    spaceWidth: settings.wordSpacing,
  })
}
