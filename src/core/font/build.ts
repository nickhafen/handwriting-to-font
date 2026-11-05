import { Font, Glyph, Path } from 'opentype.js'
import { contoursBBox, type Contour } from '../geometry'
import { placeGlyph, type SpacingSettings } from './metrics'

export const UNITS_PER_EM = 1000
/** Default line box: top of the writing area and bottom of the descender zone. */
export const DEFAULT_ASCENDER = 900
export const DEFAULT_DESCENDER = -300

export interface GlyphInput {
  /** AGL glyph name, e.g. "a", "zero", "quoteright". */
  name: string
  unicode: number
  /** Outlines in font units, y-up, baseline at 0. Horizontal position is ignored. */
  contours: Contour[]
}

export interface FontBuildInput {
  familyName: string
  glyphs: GlyphInput[]
  spacing: SpacingSettings
  /** Advance width of the space glyph, in font units. */
  spaceWidth: number
}

export interface BuiltFont {
  buffer: ArrayBuffer
  familyName: string
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
  const glyphs: Glyph[] = [notdefGlyph()]
  glyphs.push(new Glyph({ name: 'space', unicode: 0x20, advanceWidth: Math.round(input.spaceWidth) }))

  let yMax = DEFAULT_ASCENDER
  let yMin = DEFAULT_DESCENDER
  for (const g of input.glyphs) {
    const placed = placeGlyph(g.contours, input.spacing)
    const bbox = contoursBBox(placed.contours)
    if (bbox) {
      yMax = Math.max(yMax, Math.ceil(bbox.yMax))
      yMin = Math.min(yMin, Math.floor(bbox.yMin))
    }
    glyphs.push(
      new Glyph({ name: g.name, unicode: g.unicode, advanceWidth: placed.advanceWidth, path: toPath(placed.contours) }),
    )
  }

  const font = new Font({
    familyName: input.familyName,
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: DEFAULT_ASCENDER,
    descender: DEFAULT_DESCENDER,
    weightClass: 400,
    glyphs,
    tables: {
      os2: {
        // 0 = installable embedding, so Word can embed the font in documents.
        fsType: 0,
        usWeightClass: 400,
        sTypoAscender: DEFAULT_ASCENDER,
        sTypoDescender: DEFAULT_DESCENDER,
        sTypoLineGap: 0,
        // Windows clips anything outside these, so they must cover every glyph.
        usWinAscent: yMax,
        usWinDescent: -yMin,
      },
    },
  })

  return { buffer: font.toArrayBuffer(), familyName: input.familyName }
}
