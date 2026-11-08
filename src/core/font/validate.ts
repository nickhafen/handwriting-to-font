import { parse } from 'opentype.js'
import { CHARSET } from '../template/charset'
import { UNITS } from '../template/layout'
import { windingProblems } from '../trace/winding'
import { commandsToContours } from './pathCommands'

export interface FontReport {
  /** No structural problems. Missing characters and line-spacing warnings don't count. */
  ok: boolean
  /** Characters we expected but the font's cmap doesn't map to a real glyph. */
  missing: string[]
  /** Problems that would show in use (clipping, filled-in holes, embedding), in plain words with the characters named. */
  errors: string[]
  /** Worth knowing but harmless (e.g. extra line spacing). */
  warnings: string[]
  /** Characters whose contour directions don't match their nesting (holes would fill in). */
  badWinding: string[]
  /** Characters reaching above the template's top line or below its bottom line (Word adds line spacing for them). */
  tooTall: string[]
  tooDeep: string[]
  stats: {
    glyphCount: number
    maxYMax: number
    minYMin: number
    usWinAscent: number
    usWinDescent: number
    fsType: number
    familyName: string
  }
}

const BY_NAME = new Map(CHARSET.map((c) => [c.glyphName, c.char]))

/** A glyph name as people read it: "g", "th" for t_h, "e (alternate)" for e.alt1. */
export function displayGlyphName(name: string | null): string {
  if (!name) return '?'
  if (BY_NAME.has(name)) return BY_NAME.get(name)!
  const alt = /^(.+)\.alt\d+$/.exec(name)
  if (alt) return `${displayGlyphName(alt[1])} (alternate)`
  if (name.includes('_')) return name.split('_').map(displayGlyphName).join('')
  return name === 'space' ? 'space' : name
}

const list = (names: string[]) => names.map((n) => `“${n}”`).join(', ')

/**
 * Re-parse a built font and check it (spec §6 checks 1, 2 and 4, plus contour
 * direction and line spacing). Check 3 (loading through the browser's
 * FontFace API) lives in the UI layer because it needs the DOM.
 */
export function validateFont(buffer: ArrayBuffer, expectedChars: string[]): FontReport {
  const errors: string[] = []
  const warnings: string[] = []
  const font = parse(buffer)
  const os2 = font.tables.os2

  const missing = expectedChars.filter((ch) => font.charToGlyphIndex(ch) <= 0)

  let maxYMax = -Infinity
  let minYMin = Infinity
  const badWinding: string[] = []
  const clippedTop: string[] = []
  const clippedBottom: string[] = []
  const tooTall: string[] = []
  const tooDeep: string[] = []
  for (let i = 0; i < font.glyphs.length; i++) {
    const glyph = font.glyphs.get(i)
    if (glyph.name === '.notdef') continue
    const bb = glyph.getBoundingBox()
    if (bb.isEmpty()) continue
    const name = displayGlyphName(glyph.name)
    maxYMax = Math.max(maxYMax, bb.y2)
    minYMin = Math.min(minYMin, bb.y1)
    if (bb.y2 > os2.usWinAscent) clippedTop.push(name)
    if (-bb.y1 > os2.usWinDescent) clippedBottom.push(name)
    // A unit of slack: outlines that touch the writing area's edge are fine.
    if (bb.y2 > UNITS.top + 1) tooTall.push(name)
    if (bb.y1 < UNITS.bottom - 1) tooDeep.push(name)
    if (windingProblems(commandsToContours(glyph.path.commands)).length) badWinding.push(name)
  }

  if (clippedTop.length) errors.push(`The top of ${list(clippedTop)} would be cut off in Windows.`)
  if (clippedBottom.length) errors.push(`The bottom of ${list(clippedBottom)} would be cut off in Windows.`)
  if (os2.fsType !== 0) errors.push('The font doesn’t allow embedding, so Word couldn’t save it inside documents.')
  if (badWinding.length) errors.push(`The holes in ${list(badWinding)} may show up filled in.`)
  if (tooTall.length) warnings.push(`${list(tooTall)} reach${tooTall.length === 1 ? 'es' : ''} above the template’s top line, so Word will leave extra space above each line.`)
  if (tooDeep.length) warnings.push(`${list(tooDeep)} reach${tooDeep.length === 1 ? 'es' : ''} below the template’s bottom line, so Word will leave extra space below each line.`)

  return {
    ok: errors.length === 0,
    missing,
    errors,
    warnings,
    badWinding,
    tooTall,
    tooDeep,
    stats: {
      glyphCount: font.glyphs.length,
      maxYMax,
      minYMin,
      usWinAscent: os2.usWinAscent,
      usWinDescent: os2.usWinDescent,
      fsType: os2.fsType,
      familyName: font.names.fontFamily?.en ?? font.names.windows?.fontFamily?.en ?? '',
    },
  }
}
