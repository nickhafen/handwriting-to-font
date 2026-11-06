import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { CHARSET, TEMPLATE_PAGES } from '../../src/core/template/charset'
import { generateTemplatePdf } from '../../src/core/template/generatePdf'
import {
  BOX,
  CELLS_PER_PAGE,
  ID_SQUARES,
  MARKERS,
  PAGE_SIZES,
  UNITS,
  UNITS_PER_PT,
  boxOriginOnPage,
  cellGeometry,
  unitsToY,
  type Rect,
} from '../../src/core/template/layout'
import { decodePageId, encodePageId } from '../../src/core/template/pageIdCodec'

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 1e-9 &&
  inner.y >= outer.y - 1e-9 &&
  inner.x + inner.w <= outer.x + outer.w + 1e-9 &&
  inner.y + inner.h <= outer.y + outer.h + 1e-9

describe('layout', () => {
  const boxRect: Rect = { x: 0, y: 0, w: BOX.width, h: BOX.height }
  const cells = Array.from({ length: CELLS_PER_PAGE }, (_, i) => cellGeometry(i))

  it('keeps every cell inside the box and clear of the markers and ID strip', () => {
    for (const g of cells) {
      expect(inside(g.cell, boxRect)).toBe(true)
      for (const m of [...Object.values(MARKERS), ...ID_SQUARES]) expect(overlaps(g.cell, m)).toBe(false)
    }
  })

  it('keeps the writing area inside its cell and below the label strip', () => {
    for (const g of cells) {
      expect(inside(g.writing, g.cell)).toBe(true)
      expect(g.writing.y).toBeGreaterThan(g.label.y + g.label.h)
    }
  })

  it('maps the writing area edges to the top and bottom font units with one shared scale', () => {
    const g = cellGeometry(17)
    expect(unitsToY(g.writing, UNITS.top)).toBeCloseTo(g.writing.y)
    expect(unitsToY(g.writing, UNITS.bottom)).toBeCloseTo(g.writing.y + g.writing.h)
    expect((UNITS.top - UNITS.bottom) / g.writing.h).toBeCloseTo(UNITS_PER_PT)
    expect(g.guides.cap).toBeLessThan(g.guides.xHeight)
    expect(g.guides.xHeight).toBeLessThan(g.guides.baseline)
    expect(g.guides.baseline).toBeLessThan(g.guides.descender)
  })

  it('fits Letter and A4 with at least 0.5 in margins', () => {
    for (const id of Object.keys(PAGE_SIZES) as (keyof typeof PAGE_SIZES)[]) {
      const o = boxOriginOnPage(id)
      expect(o.x).toBeGreaterThanOrEqual(36 - 0.01)
      expect(o.y).toBeGreaterThanOrEqual(36 - 0.01)
    }
  })

  it('has cells at least 1 inch wide and tall', () => {
    expect(cells[0].cell.w).toBeGreaterThanOrEqual(72)
    expect(cells[0].cell.h).toBeGreaterThanOrEqual(72)
  })
})

describe('charset', () => {
  it('has every required character exactly once', () => {
    const chars = CHARSET.map((c) => c.char)
    expect(new Set(chars).size).toBe(chars.length)
    const required =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
      '!"#$%&\'()*+,-./:;<=>?@[\\]^_{|}~`' +
      '‘’“”–—…§•'
    expect([...required].filter((c) => !chars.includes(c))).toEqual([])
    expect(chars).toHaveLength(required.length)
  })

  it('puts all letters on page 1', () => {
    const page1 = TEMPLATE_PAGES[0].cells.filter((c) => c).map((c) => c!.char)
    expect(page1.join('')).toMatch(/^[A-Za-z]+$/)
    expect(page1).toHaveLength(52)
  })

  it('uses valid, unique glyph names', () => {
    const names = CHARSET.map((c) => c.glyphName)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n).toMatch(/^[A-Za-z][A-Za-z0-9]*$/)
    expect(CHARSET.find((c) => c.char === '’')!.glyphName).toBe('quoteright')
  })

  it('marks curly quotes as falling back to straight ones', () => {
    expect(CHARSET.filter((c) => c.fallbackFrom).map((c) => c.char + c.fallbackFrom)).toEqual([
      "‘'",
      "’'",
      '“"',
      '”"',
    ])
  })
})

describe('page ID codec', () => {
  it('round-trips every version and page', () => {
    for (let version = 1; version <= 15; version++) {
      for (let pageIndex = 0; pageIndex <= 15; pageIndex++) {
        expect(decodePageId(encodePageId({ version, pageIndex }))).toEqual({ version, pageIndex })
      }
    }
  })

  it('puts the version in bits 0-3 and the page in bits 4-7', () => {
    expect(encodePageId({ version: 1, pageIndex: 1 })).toEqual([true, false, false, false, true, false, false, false])
  })

  it('rejects an all-blank strip', () => {
    expect(decodePageId(Array(8).fill(false))).toBeNull()
  })
})

describe('generateTemplatePdf', () => {
  it.each(['letter', 'a4'] as const)('makes a %s PDF with one page per template page', async (size) => {
    const bytes = await generateTemplatePdf(size)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(TEMPLATE_PAGES.length)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(PAGE_SIZES[size].width, 1)
    expect(height).toBeCloseTo(PAGE_SIZES[size].height, 1)
  })
})

describe('styles and redo sheets', () => {
  it('numbers each style’s pages after the Regular ones', async () => {
    const { pageIndexOf, slotOf } = await import('../../src/core/template/styles')
    expect(pageIndexOf({ style: 'regular', page: 1 })).toBe(1)
    expect(pageIndexOf({ style: 'bold', page: 0 })).toBe(2)
    expect(pageIndexOf({ style: 'boldItalic', page: 1 })).toBe(7)
    for (let i = 0; i < 8; i++) expect(pageIndexOf(slotOf(i)!)).toBe(i)
    expect(slotOf(8)).toBeNull()
  })

  it('prints only the pages that hold redo characters', async () => {
    const bytes = await generateTemplatePdf('letter', { sheets: [{ style: 'regular', only: ['A', 'g'] }, { style: 'bold', only: ['%'] }] })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2) // Regular page 1 and Bold page 2
  })

  it('refuses to print an empty redo sheet', async () => {
    await expect(generateTemplatePdf('letter', { sheets: [{ style: 'regular', only: [] }] })).rejects.toThrow()
  })
})
