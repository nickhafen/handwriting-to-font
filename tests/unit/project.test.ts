import { describe, expect, it } from 'vitest'
import { assembleGlyphs } from '../../src/core/project'
import type { CellResult } from '../../src/core/scan/cells'
import type { PageScan } from '../../src/core/scan/processPage'
import { TEMPLATE_PAGES } from '../../src/core/template/charset'

function cell(index: number, inkArea: number, touchesEdge = false): CellResult {
  return {
    index,
    width: 10,
    height: 10,
    gray: new Uint8Array(100),
    ink: new Uint8Array(100),
    inkArea,
    inkBox: inkArea ? { minX: 1, minY: 1, maxX: 8, maxY: 8 } : null,
    yMaxUnits: inkArea ? 480 : null,
    yMinUnits: inkArea ? 0 : null,
    empty: inkArea < 40,
    touchesEdge,
    contours: [],
  }
}

/** A page scan where every template cell has `area` ink, except overrides. */
function page(pageIndex: number, overrides: Record<string, CellResult> = {}): PageScan {
  const cells = TEMPLATE_PAGES[pageIndex].cells.map((info, i) => (info && overrides[info.char]) ?? cell(i, info ? 1000 : 0))
  return { pageId: { version: 1, pageIndex }, idBits: [], idConfidence: 1, corners: {} as PageScan['corners'], cells }
}

const find = (g: ReturnType<typeof assembleGlyphs>, ch: string) => g.find((x) => x.info.char === ch)!

describe('assembleGlyphs', () => {
  it('marks every glyph on a missing page', () => {
    const g = assembleGlyphs(new Map([[0, page(0)]]))
    expect(g.filter((x) => x.pageMissing).length).toBe(51)
    expect(find(g, 'a').pageMissing).toBe(false)
  })

  it('falls back from blank curly quotes to straight ones', () => {
    const p2 = page(1, { '’': cell(9, 0) })
    const g = assembleGlyphs(new Map([[1, p2]]))
    const q = find(g, '’')
    expect(q.usesFallback).toBe(true)
    expect(q.empty).toBe(false)
    expect(q.cell).toBe(p2.cells[TEMPLATE_PAGES[1].cells.findIndex((c) => c?.char === "'")])
  })

  it('reports blank cells without a fallback as empty, and flags clipping and odd sizes', () => {
    const g = assembleGlyphs(new Map([[0, page(0, { Q: cell(16, 0), W: cell(22, 1000, true), i: cell(36, 50) })]]))
    expect(find(g, 'Q').empty).toBe(true)
    expect(find(g, 'W').clipped).toBe(true)
    expect(find(g, 'i').suspicious).toBe(true)
    expect(find(g, 'A').suspicious).toBe(false)
  })
})

describe('building a font from reviewed glyphs', () => {
  it('includes traced glyphs and fallbacks, and skips empty ones', async () => {
    const { buildProjectFont, DEFAULT_FONT_SETTINGS, glyphInputs } = await import('../../src/core/project')
    const { validateFont } = await import('../../src/core/font/validate')
    const { ellipse } = await import('../../src/core/font/m0TestGlyphs')
    const { fixWinding } = await import('../../src/core/trace/winding')
    const ring = fixWinding([ellipse(200, 240, 180, 240, true), ellipse(200, 240, 100, 160, true)])
    const withOutline = (c: CellResult): CellResult => (c.empty ? c : { ...c, contours: ring })
    const p1 = page(0, { Q: cell(16, 0) })
    const p2 = page(1, { '\u2019': cell(9, 0) })
    for (const p of [p1, p2]) p.cells = p.cells.map(withOutline)
    const glyphs = assembleGlyphs(new Map([[0, p1], [1, p2]]))

    const inputs = glyphInputs(glyphs)
    expect(inputs.find((g) => g.name === 'Q')).toBeUndefined()
    expect(inputs.find((g) => g.name === 'quoteright')).toBeDefined()
    expect(inputs).toHaveLength(102)

    const built = buildProjectFont(glyphs, DEFAULT_FONT_SETTINGS, 'AB12')
    const report = validateFont(built.buffer, [' ', ...'AQ\u2019'])
    expect(report.missing).toEqual(['Q'])
    expect(report.ok).toBe(true)
    expect(report.stats.familyName).toBe('My Handwriting AB12')
  })
})

describe('merging uploads and generated styles', () => {
  it('lets a later upload replace only the characters written on it', async () => {
    const { mergeUploads } = await import('../../src/core/project')
    const first = page(0)
    const redo = page(0)
    redo.cells = redo.cells.map((c, i) => (TEMPLATE_PAGES[0].cells[i]?.char === 'A' ? c : cell(i, 0)))
    const m = mergeUploads(0, [
      { key: 1, scan: first },
      { key: 2, scan: redo },
    ])!
    expect(m.used.get(1)).toBe(51)
    expect(m.used.get(2)).toBe(1)
    const aIndex = TEMPLATE_PAGES[0].cells.findIndex((c) => c?.char === 'A')
    expect(m.scan.cells[aIndex]).toBe(redo.cells[aIndex])
    expect(m.scan.cells[aIndex + 1]).toBe(first.cells[aIndex + 1])
  })

  it('generates italic by slanting and keeps written glyphs first', async () => {
    const { effectiveGlyphs, slantContours, DEFAULT_GENERATE } = await import('../../src/core/project')
    const { ellipse } = await import('../../src/core/font/m0TestGlyphs')
    const ring = [ellipse(200, 300, 100, 300, true)]
    const withOutline = (c: CellResult): CellResult => (c.empty ? c : { ...c, contours: ring })
    const reg = page(0)
    reg.cells = reg.cells.map(withOutline)
    const written = {
      regular: assembleGlyphs(new Map([[0, reg]]), 'regular'),
      bold: assembleGlyphs(new Map(), 'bold'),
      italic: assembleGlyphs(new Map(), 'italic'),
      boldItalic: assembleGlyphs(new Map(), 'boldItalic'),
    }
    const eff = effectiveGlyphs(written, null, DEFAULT_GENERATE)
    const a = eff.italic.find((g) => g.info.char === 'A')!
    expect(a.generated).toBe('slanted')
    expect(a.outline).toEqual(slantContours(ring, DEFAULT_GENERATE.slant))
    // Bold isn't available without the thickened Regular set, so Bold Italic isn't either.
    expect(eff.bold.find((g) => g.info.char === 'A')!.generated).toBeUndefined()
    expect(eff.boldItalic.find((g) => g.info.char === 'A')!.generated).toBeUndefined()
    // Nothing is generated when turned off.
    expect(effectiveGlyphs(written, null, { ...DEFAULT_GENERATE, italic: false }).italic.some((g) => g.generated)).toBe(false)
  })

  it('builds style-linked fonts with the right flags', async () => {
    const { buildProjectFont, DEFAULT_FONT_SETTINGS } = await import('../../src/core/project')
    const { parse } = await import('opentype.js')
    const { ellipse } = await import('../../src/core/font/m0TestGlyphs')
    const reg = page(0)
    reg.cells = reg.cells.map((c) => (c.empty ? c : { ...c, contours: [ellipse(200, 300, 100, 300, true)] }))
    const glyphs = assembleGlyphs(new Map([[0, reg]]), 'boldItalic')
    const f = parse(buildProjectFont(glyphs, DEFAULT_FONT_SETTINGS, 'ZZ99', 'boldItalic', 12).buffer)
    expect(f.names.fontSubfamily?.en ?? f.names.windows?.fontSubfamily?.en).toBe('Bold Italic')
    expect(f.tables.os2.usWeightClass).toBe(700)
    expect(f.tables.os2.fsSelection & 0x21).toBe(0x21)
    expect(f.tables.post.italicAngle).toBe(-12)
  })
})

describe('per-character position and spacing', () => {
  it('moves a glyph vertically and adds space on either side, without changing its shape', async () => {
    const { buildProjectFont, DEFAULT_FONT_SETTINGS } = await import('../../src/core/project')
    const { parse } = await import('opentype.js')
    const { ellipse } = await import('../../src/core/font/m0TestGlyphs')
    const reg = page(1)
    reg.cells = reg.cells.map((c) => (c.empty ? c : { ...c, contours: [ellipse(100, 250, 80, 30, true)] }))
    const glyphs = assembleGlyphs(new Map([[1, reg]]), 'regular')
    const settings = { ...DEFAULT_FONT_SETTINGS, letterSpacing: 0 }
    const plain = parse(buildProjectFont(glyphs, settings).buffer)
    const moved = parse(
      buildProjectFont(glyphs, settings, undefined, 'regular', 0, { 'regular:-': { shiftY: -60, spaceBefore: 40, spaceAfter: 25 } }).buffer,
    )
    const a = plain.charToGlyph('-')
    const b = moved.charToGlyph('-')
    expect(b.getBoundingBox().y1).toBeCloseTo(a.getBoundingBox().y1 - 60, 0)
    expect(b.getBoundingBox().x1).toBeCloseTo(a.getBoundingBox().x1 + 40, 0)
    expect(b.advanceWidth).toBe(a.advanceWidth + 65)
    // Other characters are untouched.
    expect(moved.charToGlyph('1').advanceWidth).toBe(plain.charToGlyph('1').advanceWidth)
  })

  it('uses the default letter spacing of −20', async () => {
    const { DEFAULT_FONT_SETTINGS } = await import('../../src/core/project')
    expect(DEFAULT_FONT_SETTINGS.letterSpacing).toBe(-20)
  })
})

describe('per-character size', () => {
  it('scales a glyph from the baseline, keeping it on the line', async () => {
    const { buildProjectFont, DEFAULT_FONT_SETTINGS } = await import('../../src/core/project')
    const { parse } = await import('opentype.js')
    const { ellipse } = await import('../../src/core/font/m0TestGlyphs')
    const reg = page(0)
    // An "o"-like shape sitting on the baseline: y from 0 to 480.
    reg.cells = reg.cells.map((c) => (c.empty ? c : { ...c, contours: [ellipse(200, 240, 180, 240, true)] }))
    const glyphs = assembleGlyphs(new Map([[0, reg]]), 'regular')
    const plain = parse(buildProjectFont(glyphs, DEFAULT_FONT_SETTINGS).buffer).charToGlyph('a').getBoundingBox()
    const big = parse(
      buildProjectFont(glyphs, DEFAULT_FONT_SETTINGS, undefined, 'regular', 0, { 'regular:a': { shiftY: 0, spaceBefore: 0, spaceAfter: 0, scale: 1.25 } }).buffer,
    )
      .charToGlyph('a')
      .getBoundingBox()
    expect(big.y1).toBeCloseTo(plain.y1, 0) // still on the baseline
    expect(big.y2).toBeCloseTo(plain.y2 * 1.25, -1)
    expect(big.x2 - big.x1).toBeCloseTo((plain.x2 - plain.x1) * 1.25, -1)
  })
})

describe('line-height metrics after size and position changes', () => {
  it('always cover every glyph exactly as written into the font (no false "would be clipped")', async () => {
    const { buildProjectFont, DEFAULT_FONT_SETTINGS } = await import('../../src/core/project')
    const { validateFont } = await import('../../src/core/font/validate')
    const { ellipse } = await import('../../src/core/font/m0TestGlyphs')
    const reg = page(0)
    // A tilted ellipse: its lowest and highest points fall partway along curves, like real traced letters.
    const t = 0.37
    const rot = (p: { x: number; y: number }) => ({ x: p.x * Math.cos(t) - p.y * Math.sin(t), y: p.x * Math.sin(t) + p.y * Math.cos(t) })
    const e = ellipse(203.37, 31.7, 141.3, 287.9, true)
    const tilted = { start: rot(e.start), segments: e.segments.map((sg) => (sg.type === 'C' ? { type: 'C' as const, c1: rot(sg.c1), c2: rot(sg.c2), to: rot(sg.to) } : sg)) }
    reg.cells = reg.cells.map((c) => (c.empty ? c : { ...c, contours: [tilted] }))
    const glyphs = assembleGlyphs(new Map([[0, reg]]), 'regular')
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 200; i++) {
      const m = { shiftY: Math.round(rand() * 500 - 250), spaceBefore: 0, spaceAfter: 0, scale: 0.5 + Math.round(rand() * 30) * 0.05 }
      const built = buildProjectFont(glyphs, DEFAULT_FONT_SETTINGS, undefined, 'regular', 0, { 'regular:g': m, 'regular:Q': m })
      const report = validateFont(built.buffer, [])
      expect(report.errors, JSON.stringify(m)).toEqual([])
    }
  })
})
