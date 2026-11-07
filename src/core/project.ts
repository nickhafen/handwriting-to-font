// Project model: merging uploaded pages, per-glyph review status, generated
// Bold/Italic styles, and building fonts. Pure functions only.
import { buildFont, type BuiltFont, type GlyphInput, type Substitutions } from './font/build'
import type { LigatureFeature } from './font/gsub'
import { DEFAULT_SPACING } from './font/metrics'
import type { Contour, Point } from './geometry'
import { suspiciousCells, type CellResult } from './scan/cells'
import type { PageScan } from './scan/processPage'
import { CHARSET, TEMPLATE_PAGES, type CharInfo } from './template/charset'
import { glyphNameOf, ligatureBoxes, ligatureGlyphName, parseLigatureText, type ParsedLigature } from './template/ligatures'
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
  /** Display text when it differs from `info.char` (ligature boxes). */
  label?: string
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
export function mergeUploads(
  pageIndex: number,
  uploads: { key: number; scan: PageScan }[],
  /** Which boxes hold something (default: the letter page's character cells). */
  hasBox: (i: number) => boolean = (i) => !!TEMPLATE_PAGES[pageIndex]?.cells[i],
): MergedPage | null {
  if (uploads.length === 0) return null
  const latest = uploads[uploads.length - 1]
  const used = new Map<number, number>(uploads.map((u) => [u.key, 0]))
  const cells = latest.scan.cells.map((_, i) => {
    if (!hasBox(i)) return latest.scan.cells[i]
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
  letterSpacing: -20,
  wordSpacing: 280,
}

// ------------------------------------------------- per-glyph position --------

/** Per-character position and spacing, applied when the font is built (the outline itself is unchanged). */
export interface GlyphMetrics {
  /** Font units to move the glyph up (+) or down (−). */
  shiftY: number
  /** Extra font units of space before and after the glyph. */
  spaceBefore: number
  spaceAfter: number
  /** Size multiplier, applied from the baseline (1 = as written). Optional in older saved projects. */
  scale?: number
}

export const DEFAULT_METRICS: GlyphMetrics = { shiftY: 0, spaceBefore: 0, spaceAfter: 0, scale: 1 }

export const isDefaultMetrics = (m?: GlyphMetrics) =>
  !m || (m.shiftY === 0 && m.spaceBefore === 0 && m.spaceAfter === 0 && (m.scale ?? 1) === 1)

/** Scale outlines by `k` from the baseline (y = 0) and the left edge (x = 0; the builder re-spaces glyphs anyway). */
export function scaleContours(contours: Contour[], k: number): Contour[] {
  if (k === 1) return contours
  const t = (p: Point): Point => ({ x: p.x * k, y: p.y * k })
  return contours.map((c) => ({
    start: t(c.start),
    segments: c.segments.map((s) => (s.type === 'L' ? { type: 'L', to: t(s.to) } : { type: 'C', c1: t(s.c1), c2: t(s.c2), to: t(s.to) })),
  }))
}

/** Key for per-character settings: "style:char". */
export const glyphKey = (style: StyleId, char: string) => `${style}:${char}`

/** Generated glyphs use the position of the Regular glyph they were made from. */
export const metricsKeyFor = (g: ReviewGlyph) => glyphKey(g.generated ? 'regular' : g.style, g.info.char)

export function shiftContours(contours: Contour[], dy: number): Contour[] {
  if (!dy) return contours
  const t = (p: Point): Point => ({ x: p.x, y: p.y + dy })
  return contours.map((c) => ({
    start: t(c.start),
    segments: c.segments.map((s) => (s.type === 'L' ? { type: 'L', to: t(s.to) } : { type: 'C', c1: t(s.c1), c2: t(s.c2), to: t(s.to) })),
  }))
}

/** Glyphs that have outlines, ready for the font builder, with any per-character position and spacing. */
export function glyphInputs(glyphs: ReviewGlyph[], metrics: Record<string, GlyphMetrics> = {}): GlyphInput[] {
  return glyphs.flatMap((g) => {
    if (!usable(g)) return []
    const m = metrics[metricsKeyFor(g)] ?? DEFAULT_METRICS
    return [{ name: g.info.glyphName, unicode: g.info.unicode || undefined, contours: shiftContours(scaleContours(g.outline, m.scale ?? 1), m.shiftY), spaceBefore: m.spaceBefore, spaceAfter: m.spaceAfter }]
  })
}

/** Build one style's font. `suffix` is added to the family name if given. */
export function buildProjectFont(
  glyphs: ReviewGlyph[],
  settings: FontSettings,
  suffix?: string,
  style: StyleId = 'regular',
  slant = 0,
  metrics: Record<string, GlyphMetrics> = {},
  ligatures: LigatureGlyph[] = [],
): BuiltFont {
  const base = settings.familyName.trim() || DEFAULT_FONT_SETTINGS.familyName
  const info = styleInfo(style)
  const ready = ligatures.filter(ligatureReady)
  return buildFont({
    familyName: suffix ? `${base} ${suffix}` : base,
    glyphs: [...glyphInputs(glyphs, metrics), ...glyphInputs(ready, metrics)],
    substitutions: substitutionsFor(ready),
    spacing: { ...DEFAULT_SPACING, letterSpacing: settings.letterSpacing },
    spaceWidth: settings.wordSpacing,
    style: { name: info.label, weight: info.weight, italicAngle: info.italic ? -(slant || DEFAULT_GENERATE.slant) : 0 },
  })
}

// ------------------------------------------------------------- ligatures ----

export const ligatureKey = (sheet: number, box: number) => `lig:${sheet}:${box}`

export interface LigatureSettings {
  /** What each box holds, typed by the user (preset on the common sheet), by ligatureKey. */
  texts: Record<string, string>
  /** Feature for each ligature box, by ligatureKey. Alternates always use calt. */
  features: Record<string, LigatureFeature>
}

export const DEFAULT_LIGATURE_FEATURE: LigatureFeature = 'liga'

export interface LigatureGlyph extends ReviewGlyph {
  sheet: number
  box: number
  text: string
  parsed: ParsedLigature
  feature: LigatureFeature
  /** Another box with the same text is used instead (the newest one wins). */
  duplicate: boolean
}

/** Box text: what the user typed, or the common sheet's preset. */
export function ligatureText(settings: LigatureSettings, sheet: number, box: number): string {
  const typed = settings.texts[ligatureKey(sheet, box)]
  return typed ?? ligatureBoxes(sheet)[box]?.preset ?? ''
}

/** One entry per box of each uploaded ligature sheet, in sheet and box order. */
export function assembleLigatures(sheets: ReadonlyMap<number, PageScan>, settings: LigatureSettings): LigatureGlyph[] {
  const out: LigatureGlyph[] = []
  for (const sheet of [...sheets.keys()].sort((a, b) => a - b)) {
    const scan = sheets.get(sheet)!
    for (const box of ligatureBoxes(sheet)) {
      const cell = scan.cells[box.index]
      if (!cell) continue
      const key = ligatureKey(sheet, box.index)
      const text = ligatureText(settings, sheet, box.index)
      const parsed = parseLigatureText(text)
      out.push({
        info: { char: key, unicode: 0, glyphName: `lig_${sheet}_${box.index}` },
        label: text || `Box ${box.index + 1}`,
        style: 'regular',
        pageIndex: sheet,
        cell,
        outline: cell.empty ? [] : cell.contours,
        pageMissing: false,
        empty: cell.empty,
        clipped: !cell.empty && cell.touchesEdge,
        suspicious: false,
        usesFallback: false,
        sheet,
        box: box.index,
        text,
        parsed,
        feature: parsed.kind === 'alternate' ? 'calt' : (settings.features[key] ?? DEFAULT_LIGATURE_FEATURE),
        duplicate: false,
      })
    }
  }
  // Same text in several boxes: the newest (last) one is used.
  const seen = new Set<string>()
  for (let i = out.length - 1; i >= 0; i--) {
    const g = out[i]
    if (g.empty || (g.parsed.kind !== 'ligature' && g.parsed.kind !== 'alternate')) continue
    const sig = g.text.trim()
    if (seen.has(sig)) g.duplicate = true
    seen.add(sig)
  }
  // Glyph names: t_h for ligatures; e.alt1, e.alt2, ... for alternates.
  const altCount = new Map<string, number>()
  for (const g of out) {
    if (g.duplicate || g.empty) continue
    if (g.parsed.kind === 'ligature') g.info = { ...g.info, glyphName: ligatureGlyphName(g.parsed.chars) }
    if (g.parsed.kind === 'alternate') {
      const base = glyphNameOf(g.parsed.target)
      const n = (altCount.get(base) ?? 0) + 1
      altCount.set(base, n)
      g.info = { ...g.info, glyphName: `${base}.alt${n}` }
    }
  }
  return out
}

/** Has ink, a valid text, and isn't shadowed by a duplicate. */
export const ligatureReady = (g: LigatureGlyph) =>
  usable(g) && !g.duplicate && (g.parsed.kind === 'ligature' || g.parsed.kind === 'alternate')

export function substitutionsFor(ready: LigatureGlyph[]): Substitutions {
  const names = (chars: string[]) => chars.map(glyphNameOf)
  return {
    ligatures: ready.flatMap((g) =>
      g.parsed.kind === 'ligature' ? [{ feature: g.feature, components: names(g.parsed.chars), glyph: g.info.glyphName }] : [],
    ),
    alternates: ready.flatMap((g) =>
      g.parsed.kind === 'alternate'
        ? [{ before: names(g.parsed.before), target: glyphNameOf(g.parsed.target), after: names(g.parsed.after), glyph: g.info.glyphName }]
        : [],
    ),
  }
}

/**
 * Ligatures for each style's font. Ligature sheets are written in Regular; a
 * fully generated Italic gets them slanted. Bold styles don't get them yet.
 */
export function ligaturesForStyle(
  style: StyleId,
  ligatures: LigatureGlyph[],
  writtenStyles: ReadonlySet<StyleId>,
  gen: GenerateSettings,
): LigatureGlyph[] {
  if (style === 'regular') return ligatures
  if (style === 'italic' && gen.italic && !writtenStyles.has('italic')) {
    return ligatures.map((g) => ({ ...g, outline: slantContours(g.outline, gen.slant), generated: 'slanted' as const }))
  }
  return []
}

export { STYLE_IDS }
