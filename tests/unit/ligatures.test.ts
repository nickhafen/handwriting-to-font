import { describe, expect, it } from 'vitest'
import { parse } from 'opentype.js'
import { buildFont } from '../../src/core/font/build'
import { DEFAULT_SPACING } from '../../src/core/font/metrics'
import { assembleLigatures, buildProjectFont, DEFAULT_FONT_SETTINGS, ligatureKey, ligatureReady } from '../../src/core/project'
import type { CellResult } from '../../src/core/scan/cells'
import { processPage, type PageScan } from '../../src/core/scan/processPage'
import { BOX, GRID, ID_SQUARES, MARKERS, type Rect } from '../../src/core/template/layout'
import {
  BLANK_SHEETS,
  COMMON_LIGATURES,
  COMMON_SHEET,
  ligatureBoxes,
  ligatureBoxGeometry,
  ligatureSheetOf,
  pageIndexOfLigatureSheet,
  parseLigatureText,
} from '../../src/core/template/ligatures'
import { photograph, renderPage } from './helpers/synthPage'

// Shared edges are fine; ignore floating-point slivers.
const E = 1e-6
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w - E && b.x < a.x + a.w - E && a.y < b.y + b.h - E && b.y < a.y + a.h - E

describe('ligature box text', () => {
  it('reads ligatures, contextual alternates, and mistakes', () => {
    expect(parseLigatureText('th')).toEqual({ kind: 'ligature', chars: ['t', 'h'] })
    expect(parseLigatureText(' ffi ')).toEqual({ kind: 'ligature', chars: ['f', 'f', 'i'] })
    expect(parseLigatureText('r[e]')).toEqual({ kind: 'alternate', before: ['r'], target: 'e', after: [] })
    expect(parseLigatureText('[o]n')).toEqual({ kind: 'alternate', before: [], target: 'o', after: ['n'] })
    expect(parseLigatureText('')).toEqual({ kind: 'none' })
    expect(parseLigatureText('e').kind).toBe('error')
    expect(parseLigatureText('[e]').kind).toBe('error')
    expect(parseLigatureText('r[er]').kind).toBe('error')
    expect(parseLigatureText('t h').kind).toBe('error') // space isn't a drawn character
    expect(parseLigatureText('ñx').kind).toBe('error')
  })
})

describe('ligature sheets', () => {
  it('uses page indices 8-15 without touching letter pages', () => {
    expect(ligatureSheetOf(7)).toBeNull()
    expect(ligatureSheetOf(pageIndexOfLigatureSheet(COMMON_SHEET))).toBe(0)
    expect(ligatureSheetOf(15)).toBe(BLANK_SHEETS)
    expect(pageIndexOfLigatureSheet(BLANK_SHEETS)).toBe(15)
  })

  it('lays boxes inside the grid without overlaps', () => {
    for (const sheet of [COMMON_SHEET, 1]) {
      const geoms = ligatureBoxes(sheet).map(ligatureBoxGeometry)
      for (const [i, g] of geoms.entries()) {
        expect(g.cell.x + g.cell.w).toBeLessThanOrEqual(GRID.x + GRID.width + 1e-6)
        for (const m of [...Object.values(MARKERS), ...ID_SQUARES]) expect(overlaps(g.cell, m)).toBe(false)
        for (const h of geoms.slice(i + 1)) expect(overlaps(g.cell, h.cell)).toBe(false)
        expect(g.cell.y + g.cell.h).toBeLessThanOrEqual(BOX.height)
      }
    }
    expect(ligatureBoxes(COMMON_SHEET).map((b) => b.preset)).toEqual(COMMON_LIGATURES)
    expect(ligatureBoxes(COMMON_SHEET).every((b) => b.span === b.preset!.length)).toBe(true)
  })

  it('scans a blank sheet into its own boxes', () => {
    const boxes = ligatureBoxes(1)
    const wide = boxes.find((b) => b.span === 3)!
    const page = renderPage(pageIndexOfLigatureSheet(1), 150, [
      { cell: 0, top: 480, bottom: 0, writing: ligatureBoxGeometry(boxes[0]).writing },
      { cell: 0, top: 700, bottom: -200, x0: 0.1, x1: 0.9, writing: ligatureBoxGeometry(wide).writing },
    ])
    const scan = processPage(photograph(page, { rotate: 3, skew: 0.01, seed: 2 }))
    expect(scan.pageId?.pageIndex).toBe(pageIndexOfLigatureSheet(1))
    expect(scan.cells).toHaveLength(boxes.length)
    expect(scan.cells.filter((c) => !c.empty).map((c) => c.index)).toEqual([0, wide.index])
    // A 3-wide box is about 3 times as wide as a single box, and holds the full stroke.
    expect(scan.cells[wide.index].width).toBeGreaterThan(scan.cells[0].width * 2.8)
    expect(Math.abs(scan.cells[wide.index].yMinUnits! + 200)).toBeLessThan(30)
  })
})

// ---------------------------------------------------------------- fonts ------

const box = (w: number) => [
  {
    start: { x: 0, y: 0 },
    segments: [
      { type: 'L' as const, to: { x: w, y: 0 } },
      { type: 'L' as const, to: { x: w, y: 400 } },
      { type: 'L' as const, to: { x: 0, y: 400 } },
    ],
  },
]

describe('GSUB', () => {
  it('writes ligature and contextual-alternate lookups that round-trip', () => {
    const g = (name: string, ch?: string) => ({ name, unicode: ch?.codePointAt(0), contours: box(200) })
    const built = buildFont({
      familyName: 'G',
      spacing: DEFAULT_SPACING,
      spaceWidth: 200,
      glyphs: [g('r', 'r'), g('e', 'e'), g('t', 't'), g('h', 'h'), g('t_h'), g('e.alt1')],
      substitutions: {
        ligatures: [
          { feature: 'liga', components: ['t', 'h'], glyph: 't_h' },
          { feature: 'liga', components: ['t', 'x'], glyph: 't_h' }, // "x" is missing: skipped
        ],
        alternates: [{ before: ['r'], target: 'e', after: [], glyph: 'e.alt1' }],
      },
    })
    const font = parse(built.buffer)
    const gsub = font.tables.gsub
    expect(gsub.features.map((f: { tag: string }) => f.tag)).toEqual(['calt', 'liga'])
    expect(gsub.lookups.map((l: { lookupType: number }) => l.lookupType)).toEqual([4, 6, 1])
    const lig = gsub.lookups[0].subtables[0]
    expect(lig.ligatureSets).toHaveLength(1)
    expect(font.glyphs.get(lig.ligatureSets[0][0].ligGlyph).name).toBe('t_h')
    expect(gsub.lookups[1].subtables[0].substFormat).toBe(3)
  })
})

function ligatureScan(sheet: number, inked: number[]): PageScan {
  const cells: CellResult[] = ligatureBoxes(sheet).map((b) => ({
    index: b.index,
    width: 281 * b.span,
    height: 233,
    gray: new Uint8Array(1),
    ink: new Uint8Array(1),
    inkArea: inked.includes(b.index) ? 900 : 0,
    inkBox: null,
    yMaxUnits: null,
    yMinUnits: null,
    empty: !inked.includes(b.index),
    touchesEdge: false,
    contours: inked.includes(b.index) ? box(300 * b.span) : [],
  }))
  return { pageId: { version: 1, pageIndex: pageIndexOfLigatureSheet(sheet) }, idBits: [], idConfidence: 1, corners: {} as PageScan['corners'], cells }
}

describe('assembling ligatures', () => {
  it('uses preset text on the common sheet and typed text on blank sheets', () => {
    const sheets = new Map([
      [COMMON_SHEET, ligatureScan(COMMON_SHEET, [1, 10])], // "ff" and "th"
      [1, ligatureScan(1, [0, 1, 2, 14])],
    ])
    const ligs = assembleLigatures(sheets, {
      texts: { [ligatureKey(1, 0)]: 'r[e]', [ligatureKey(1, 1)]: 'o[e]', [ligatureKey(1, 14)]: 'th', [ligatureKey(1, 2)]: 'e' },
      features: { [ligatureKey(1, 14)]: 'dlig' },
    })
    const by = (sheet: number, b: number) => ligs.find((g) => g.sheet === sheet && g.box === b)!
    expect(by(COMMON_SHEET, 1).text).toBe('ff')
    expect(by(COMMON_SHEET, 1).info.glyphName).toBe('f_f')
    // "th" on blank sheet 1 is newer than the common sheet's "th", so it wins.
    expect(by(COMMON_SHEET, 10).duplicate).toBe(true)
    expect(by(1, 14).duplicate).toBe(false)
    expect(by(1, 14).feature).toBe('dlig')
    // Two alternates for "e" get numbered names; alternates always use calt.
    expect([by(1, 0).info.glyphName, by(1, 1).info.glyphName]).toEqual(['e.alt1', 'e.alt2'])
    expect(by(1, 0).feature).toBe('calt')
    // A single letter without context is an error, so it's not used.
    expect(by(1, 2).parsed.kind).toBe('error')
    expect(ligs.filter(ligatureReady).map((g) => g.info.glyphName).sort()).toEqual(['e.alt1', 'e.alt2', 'f_f', 't_h'])
  })

  it('puts them in the built font', () => {
    const ligs = assembleLigatures(new Map([[1, ligatureScan(1, [0, 14])]]), {
      texts: { [ligatureKey(1, 0)]: 'r[e]', [ligatureKey(1, 14)]: 'th' },
      features: {},
    })
    const font = parse(buildProjectFont([], DEFAULT_FONT_SETTINGS, undefined, 'regular', 0, {}, ligs).buffer)
    // No letters were uploaded, so the rules have nothing to point at and are skipped; the glyphs are still there.
    expect(font.tables.gsub).toBeUndefined()
    const names = Array.from({ length: font.glyphs.length }, (_, i) => font.glyphs.get(i).name)
    expect(names).toEqual(expect.arrayContaining(['t_h', 'e.alt1']))
  })
})
