import { describe, expect, it } from 'vitest'
import { parse } from 'opentype.js'
import { buildFont, buildSuffix } from '../../src/core/font/build'
import { DEFAULT_SPACING, placeGlyph } from '../../src/core/font/metrics'
import { m0TestGlyphs } from '../../src/core/font/m0TestGlyphs'
import { validateFont } from '../../src/core/font/validate'
import { contoursBBox, signedArea } from '../../src/core/geometry'

describe('placeGlyph', () => {
  it('moves ink to the left sidebearing and sets the advance width', () => {
    const [o] = m0TestGlyphs()
    const placed = placeGlyph(o.contours, { lsb: 50, rsb: 60, letterSpacing: 10 })
    const bbox = contoursBBox(placed.contours)!
    expect(bbox.xMin).toBeCloseTo(60)
    expect(placed.advanceWidth).toBe(Math.round(440 + 60 + 70))
  })

  it('never moves a glyph vertically', () => {
    const [, p] = m0TestGlyphs()
    const before = contoursBBox(p.contours)!
    const after = contoursBBox(placeGlyph(p.contours, DEFAULT_SPACING).contours)!
    expect(after.yMin).toBe(before.yMin)
    expect(after.yMax).toBe(before.yMax)
  })
})

describe('test glyph winding', () => {
  it('has counter-clockwise outers and clockwise holes', () => {
    const [o] = m0TestGlyphs()
    expect(signedArea(o.contours[0])).toBeGreaterThan(0)
    expect(signedArea(o.contours[1])).toBeLessThan(0)
  })
})

describe('buildFont', () => {
  const built = buildFont({
    familyName: 'Test Hand',
    glyphs: m0TestGlyphs(),
    spacing: DEFAULT_SPACING,
    spaceWidth: 280,
  })

  it('round-trips through opentype.parse as a CFF font', () => {
    const font = parse(built.buffer)
    expect(font.tables.cff).toBeDefined()
    expect(font.glyphs.get(0).name).toBe('.notdef')
    for (const ch of [' ', 'o', 'p', 'l']) expect(font.charToGlyphIndex(ch)).toBeGreaterThan(0)
    expect(font.charToGlyph(' ').advanceWidth).toBe(280)
    expect(font.charToGlyph('o').path.commands.filter((c) => c.type === 'M')).toHaveLength(2)
  })

  it('passes validation, with win metrics covering every glyph', () => {
    const report = validateFont(built.buffer, [' ', 'o', 'p', 'l'])
    expect(report.errors).toEqual([])
    expect(report.stats.usWinAscent).toBeGreaterThanOrEqual(900)
    expect(report.stats.usWinDescent).toBeGreaterThanOrEqual(300)
    expect(report.stats.fsType).toBe(0)
    expect(report.stats.familyName).toBe('Test Hand')
  })

  it('reports missing characters separately from structural problems', () => {
    const report = validateFont(built.buffer, ['o', 'z'])
    expect(report.missing).toEqual(['z'])
    expect(report.ok).toBe(true)
  })
})

describe('buildSuffix', () => {
  it('is 4 characters and changes between minutes', () => {
    const a = buildSuffix(new Date('2026-11-05T12:00:00Z'))
    const b = buildSuffix(new Date('2026-11-05T12:01:00Z'))
    expect(a).toMatch(/^[0-9A-Z]{4}$/)
    expect(a).not.toBe(b)
  })
})
