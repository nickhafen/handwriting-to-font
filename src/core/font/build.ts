import { Font, Glyph, Path } from 'opentype.js'
import type { Contour } from '../geometry'
import { buildGsub, type LigatureFeature } from './gsub'
import { placeGlyph, type SpacingSettings } from './metrics'

export const UNITS_PER_EM = 1000
/** Default line box: top of the writing area and bottom of the descender zone. */
export const DEFAULT_ASCENDER = 900
export const DEFAULT_DESCENDER = -300

export interface GlyphInput {
  /** AGL glyph name, e.g. "a", "zero", "quoteright"; ligatures like "t_h", alternates like "e.alt1". */
  name: string
  /** Omitted for ligatures and alternates, which are reached only through substitutions. */
  unicode?: number
  /** Outlines in font units, y-up, baseline at 0. Horizontal position is ignored. */
  contours: Contour[]
  /** Extra font units of space before / after this glyph (added to the sidebearings). */
  spaceBefore?: number
  spaceAfter?: number
}

export interface FontBuildInput {
  familyName: string
  glyphs: GlyphInput[]
  spacing: SpacingSettings
  /** Advance width of the space glyph, in font units. */
  spaceWidth: number
  /** Style within the family. Default: Regular, weight 400, upright. */
  style?: FontStyle
  /** Ligature and contextual-alternate rules, by glyph name. Rules naming a missing glyph are skipped. */
  substitutions?: Substitutions
}

export interface Substitutions {
  ligatures: { feature: LigatureFeature; components: string[]; glyph: string }[]
  alternates: { before: string[]; target: string; after: string[]; glyph: string }[]
}

export interface FontStyle {
  /** Style name (nameID 2): Regular, Bold, Italic or Bold Italic, so Windows links the family. */
  name: string
  weight: number
  /** Degrees, negative = leaning right (the OpenType convention). Sets the italic flags. */
  italicAngle: number
}

export const REGULAR_STYLE: FontStyle = { name: 'Regular', weight: 400, italicAngle: 0 }

export interface BuiltFont {
  buffer: ArrayBuffer
  familyName: string
  styleName: string
}

/**
 * A short code that changes every minute, appended to the family name so
 * Windows doesn't show cached glyphs from an earlier install of the same name.
 */
export function buildSuffix(date: Date = new Date()): string {
  const minutes = Math.floor(date.getTime() / 60000)
  return (minutes % 36 ** 4).toString(36).toUpperCase().padStart(4, '0')
}

function toPath(contours: Contour[]): Path {
  const path = new Path()
  const r = Math.round
  for (const c of contours) {
    path.moveTo(r(c.start.x), r(c.start.y))
    for (const s of c.segments) {
      if (s.type === 'L') path.lineTo(r(s.to.x), r(s.to.y))
      else path.curveTo(r(s.c1.x), r(s.c1.y), r(s.c2.x), r(s.c2.y), r(s.to.x), r(s.to.y))
    }
    path.close()
  }
  return path
}

function rect(x0: number, y0: number, x1: number, y1: number, ccw: boolean): Contour {
  const pts = ccw
    ? [{ x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
    : [{ x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y0 }]
  return { start: { x: x0, y: y0 }, segments: pts.map((to) => ({ type: 'L', to })) }
}

/** The standard hollow-box .notdef glyph. */
function notdefGlyph(): Glyph {
  const contours = [rect(50, 0, 450, 700, true), rect(100, 50, 400, 650, false)]
  return new Glyph({ name: '.notdef', advanceWidth: 500, path: toPath(contours) })
}

export function buildFont(input: FontBuildInput): BuiltFont {
  const style = input.style ?? REGULAR_STYLE
  const glyphs: Glyph[] = [notdefGlyph()]
  glyphs.push(new Glyph({ name: 'space', unicode: 0x20, advanceWidth: Math.round(input.spaceWidth) }))

  let yMax = DEFAULT_ASCENDER
  let yMin = DEFAULT_DESCENDER
  for (const g of input.glyphs) {
    const placed = placeGlyph(g.contours, {
      ...input.spacing,
      lsb: input.spacing.lsb + (g.spaceBefore ?? 0),
      rsb: input.spacing.rsb + (g.spaceAfter ?? 0),
    })
    const glyph = new Glyph({ name: g.name, unicode: g.unicode, advanceWidth: placed.advanceWidth, path: toPath(placed.contours) })
    // Measure the glyph as written (coordinates rounded to whole units), not the
    // unrounded outline: rounding can move a curve's lowest point a fraction lower.
    const bb = glyph.getBoundingBox()
    if (!bb.isEmpty()) {
      yMax = Math.max(yMax, Math.ceil(bb.y2))
      yMin = Math.min(yMin, Math.floor(bb.y1))
    }
    glyphs.push(glyph)
  }

  const font = new Font({
    familyName: input.familyName,
    styleName: style.name,
    unitsPerEm: UNITS_PER_EM,
    ascender: DEFAULT_ASCENDER,
    descender: DEFAULT_DESCENDER,
    weightClass: style.weight,
    italicAngle: style.italicAngle,
    glyphs,
    tables: {
      os2: {
        // 0 = installable embedding, so Word can embed the font in documents.
        fsType: 0,
        usWeightClass: style.weight,
        sTypoAscender: DEFAULT_ASCENDER,
        sTypoDescender: DEFAULT_DESCENDER,
        sTypoLineGap: 0,
        // Windows clips anything outside these, so they must cover every glyph.
        usWinAscent: yMax,
        usWinDescent: -yMin,
      },
    },
  })

  if (input.substitutions) {
    const index = new Map(glyphs.map((g, i) => [g.name, i]))
    const ids = (names: string[]) => (names.every((n) => index.has(n)) ? names.map((n) => index.get(n)!) : null)
    const ligatures = input.substitutions.ligatures.flatMap((r) => {
      const c = ids(r.components)
      return c && index.has(r.glyph) ? [{ feature: r.feature, components: c, glyph: index.get(r.glyph)! }] : []
    })
    const alternates = input.substitutions.alternates.flatMap((r) => {
      const b = ids(r.before)
      const a = ids(r.after)
      return b && a && index.has(r.target) && index.has(r.glyph) ? [{ before: b, target: index.get(r.target)!, after: a, glyph: index.get(r.glyph)! }] : []
    })
    const gsub = buildGsub(ligatures, alternates)
    if (gsub) font.tables.gsub = gsub
  }

  return { buffer: font.toArrayBuffer(), familyName: input.familyName, styleName: style.name }
}
