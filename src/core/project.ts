// Project model: merging uploaded pages, per-glyph review status, generated
// Bold/Italic styles, and building fonts. Pure functions only.
import { buildFont, type BuiltFont, type GlyphInput } from './font/build'
import { DEFAULT_SPACING } from './font/metrics'
import type { Contour, Point } from './geometry'
import { suspiciousCells, type CellResult } from './scan/cells'
import type { PageScan } from './scan/processPage'
import { CHARSET, TEMPLATE_PAGES, type CharInfo } from './template/charset'
import { STYLE_IDS, styleInfo, type StyleId } from './template/styles'

/** Merged scans of one style, keyed by template page (0 = letters, 1 = numbers and punctuation). */
export type PagesByIndex = ReadonlyMap<number, PageScan>

export interface ReviewGlyph {
  info: CharInfo
  style: StyleId
  /** Template page (0 or 1) the character is written on. */
  pageIndex: number
  /** The scanned cell shown for this glyph (its own, the fallback's, or the Regular one it was generated from). */
  cell?: CellResult
  /** Outlines that go into the font (usually `cell.contours`; slanted for generated italics). */
  outline: Contour[]
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
  /** Made from the Regular glyph instead of a written one. */
  generated?: 'thickened' | 'slanted' | 'thickened and slanted'
}

/** Where each character lives on the template. */
const LOCATION = new Map<string, { pageIndex: number; cellIndex: number }>()
TEMPLATE_PAGES.forEach((p) => p.cells.forEach((c, i) => c && LOCATION.set(c.char, { pageIndex: p.index, cellIndex: i })))

export function locate(char: string): { pageIndex: number; cellIndex: number } | undefined {
  return LOCATION.get(char)
}

function cellFor(pages: PagesByIndex, char: string): CellResult | undefined {
  const loc = LOCATION.get(char)
  return loc && pages.get(loc.pageIndex)?.cells[loc.cellIndex]
}

export const usable = (g: ReviewGlyph) => !!g.cell && !g.empty && g.outline.length > 0

export function assembleGlyphs(pages: PagesByIndex, style: StyleId = 'regular'): ReviewGlyph[] {
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
      style,
      pageIndex,
      cell,
      outline: cell && !cell.empty ? cell.contours : [],
      pageMissing: !own,
      empty: !!own && !!cell?.empty,
      clipped: !!cell && !cell.empty && cell.touchesEdge,
      suspicious: !usesFallback && suspicious.has(info.char),
      usesFallback,
    }
  })
}

// ------------------------------------------------------------- merging -------

export interface MergedPage {
  scan: PageScan
  /** How many characters each upload contributes (by upload key). */
  used: Map<number, number>
}

/**
 * Combine several uploads of the same template page, oldest first. For each
 * character, the newest upload where that box has writing wins; a blank box
 * keeps the earlier version. That's what makes redo sheets work.
 */
export function mergeUploads(pageIndex: number, uploads: { key: number; scan: PageScan }[]): MergedPage | null {
  if (uploads.length === 0) return null
  const latest = uploads[uploads.length - 1]
  const used = new Map<number, number>(uploads.map((u) => [u.key, 0]))
  const cells = latest.scan.cells.map((_, i) => {
    if (!TEMPLATE_PAGES[pageIndex]?.cells[i]) return latest.scan.cells[i]
    for (let k = uploads.length - 1; k >= 0; k--) {
      const cell = uploads[k].scan.cells[i]
      if (!cell.empty) {
        used.set(uploads[k].key, used.get(uploads[k].key)! + 1)
        return cell
      }
    }
    return latest.scan.cells[i]
  })
  return { scan: { ...latest.scan, cells }, used }
}

// ------------------------------------------------------- generated styles ----

export interface GenerateSettings {
  /** Make Bold from Regular for characters without a written Bold version. */
  bold: boolean
  /** Pixels (300 DPI) added to each side of Regular strokes for generated Bold. */
  boldAmount: number
  /** Make Italic (and Bold Italic) by slanting, for characters without a written version. */
  italic: boolean
  /** Slant angle in degrees for generated italics. */
  slant: number
}

export const DEFAULT_GENERATE: GenerateSettings = { bold: true, boldAmount: 2, italic: true, slant: 12 }

/** Slant outlines to the right by `degrees`, pivoting on the baseline. */
export function slantContours(contours: Contour[], degrees: number): Contour[] {
  const k = Math.tan((degrees * Math.PI) / 180)
  const t = (p: Point): Point => ({ x: p.x + p.y * k, y: p.y })
  return contours.map((c) => ({
    start: t(c.start),
    segments: c.segments.map((s) => (s.type === 'L' ? { type: 'L', to: t(s.to) } : { type: 'C', c1: t(s.c1), c2: t(s.c2), to: t(s.to) })),
  }))
}

export type GlyphsByStyle = Record<StyleId, ReviewGlyph[]>

/**
 * The glyphs that go into each style's font: written ones where they exist,
 * otherwise (if enabled) generated from Regular. `boldFromRegular` is the
 * Regular set re-traced with thicker strokes.
 */
export function effectiveGlyphs(written: GlyphsByStyle, boldFromRegular: ReviewGlyph[] | null, gen: GenerateSettings): GlyphsByStyle {
  const pick = (w: ReviewGlyph, make: () => ReviewGlyph | null) => (usable(w) ? w : (make() ?? w))
  const bold = written.bold.map((w, i) =>
    pick(w, () => {
      const b = boldFromRegular?.[i]
      return gen.bold && b && usable(b) ? { ...b, style: 'bold', generated: 'thickened', suspicious: false } : null
    }),
  )
  const slanted = (base: ReviewGlyph, style: StyleId, how: ReviewGlyph['generated']): ReviewGlyph | null =>
    gen.italic && usable(base) ? { ...base, style, outline: slantContours(base.outline, gen.slant), generated: how, suspicious: false } : null
  const italic = written.italic.map((w, i) => pick(w, () => slanted(written.regular[i], 'italic', 'slanted')))
  const boldItalic = written.boldItalic.map((w, i) =>
    pick(w, () => slanted(bold[i], 'boldItalic', bold[i].generated ? 'thickened and slanted' : 'slanted')),
  )
  return { regular: written.regular, bold, italic, boldItalic }
}

export const usableCount = (glyphs: ReviewGlyph[]) => glyphs.filter(usable).length

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

/** Glyphs that have outlines, ready for the font builder. Fallbacks reuse the source outlines. */
export function glyphInputs(glyphs: ReviewGlyph[]): GlyphInput[] {
  return glyphs.flatMap((g) => (usable(g) ? [{ name: g.info.glyphName, unicode: g.info.unicode, contours: g.outline }] : []))
}

/** Build one style's font. `suffix` is added to the family name if given. */
export function buildProjectFont(glyphs: ReviewGlyph[], settings: FontSettings, suffix?: string, style: StyleId = 'regular', slant = 0): BuiltFont {
  const base = settings.familyName.trim() || DEFAULT_FONT_SETTINGS.familyName
  const info = styleInfo(style)
  return buildFont({
    familyName: suffix ? `${base} ${suffix}` : base,
    glyphs: glyphInputs(glyphs),
    spacing: { ...DEFAULT_SPACING, letterSpacing: settings.letterSpacing },
    spaceWidth: settings.wordSpacing,
    style: { name: info.label, weight: info.weight, italicAngle: info.italic ? -(slant || DEFAULT_GENERATE.slant) : 0 },
  })
}

export { STYLE_IDS }
