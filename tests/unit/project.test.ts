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
