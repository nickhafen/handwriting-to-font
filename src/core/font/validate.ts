import { parse } from 'opentype.js'
import { windingProblems } from '../trace/winding'
import { commandsToContours } from './pathCommands'

export interface FontReport {
  /** No structural problems (missing characters are reported separately). */
  ok: boolean
  /** Characters we expected but the font's cmap doesn't map to a real glyph. */
  missing: string[]
  errors: string[]
  /** Glyph names whose contour directions don't match their nesting (holes would fill in). */
  badWinding: string[]
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

/**
 * Re-parse a built font and check it (spec §6 checks 1, 2 and 4, plus contour
 * direction). Check 3 (loading through the browser's FontFace API) lives in
 * the UI layer because it needs the DOM.
 */
export function validateFont(buffer: ArrayBuffer, expectedChars: string[]): FontReport {
  const errors: string[] = []
  const font = parse(buffer)

  const missing = expectedChars.filter((ch) => font.charToGlyphIndex(ch) <= 0)

  let maxYMax = -Infinity
  let minYMin = Infinity
  const badWinding: string[] = []
  for (let i = 0; i < font.glyphs.length; i++) {
    const glyph = font.glyphs.get(i)
    const bb = glyph.getBoundingBox()
    if (bb.isEmpty()) continue
    maxYMax = Math.max(maxYMax, bb.y2)
    minYMin = Math.min(minYMin, bb.y1)
    if (windingProblems(commandsToContours(glyph.path.commands)).length) badWinding.push(glyph.name ?? `#${i}`)
  }

  const os2 = font.tables.os2
  if (os2.usWinAscent < maxYMax) {
    errors.push(`usWinAscent (${os2.usWinAscent}) is below the tallest glyph (${maxYMax}); Windows would clip it.`)
  }
  if (os2.usWinDescent < Math.abs(minYMin)) {
    errors.push(`usWinDescent (${os2.usWinDescent}) is less than the lowest descender (${minYMin}); Windows would clip it.`)
  }
  if (os2.fsType !== 0) errors.push(`fsType is ${os2.fsType}; it should be 0 so Word can embed the font.`)
  if (badWinding.length) errors.push(`Contour direction is wrong in: ${badWinding.join(', ')} (holes may fill in).`)

  return {
    ok: errors.length === 0,
    missing,
    errors,
    badWinding,
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
