// Draws the printable template from layout.ts. No geometry is defined here.
import { PDFDocument, StandardFonts, grayscale, rgb, type Color, type PDFFont, type PDFPage } from 'pdf-lib'
import { TEMPLATE_PAGES, type CharInfo } from './charset'
import {
  BOX,
  FRAME_GRAY,
  LABEL_FILL_GRAY,
  GUIDE_RGB,
  HEADER,
  HEADER_GRAY,
  ID_EXT_SQUARES,
  ID_SQUARES,
  INSET,
  LABEL_GRAY,
  MARKER_HOLE_RECT,
  MARKERS,
  PAGE_SIZES,
  TEMPLATE_VERSION,
  boxOriginOnPage,
  cellGeometry,
  type CellGeometry,
  type PageSizeId,
  type Rect,
} from './layout'
import { encodeIdExt, encodePageId, type PageId } from './pageIdCodec'
import { COMMON_SHEET, ligatureBoxes, ligatureBoxGeometry, ligaturePageId, ligatureSheetName, ligatureSheetStyle, sheetNumber, type LigatureBox } from './ligatures'
import { pageIndexOf, styleInfo, type StyleId } from './styles'

const BLACK = rgb(0, 0, 0)
const WHITE = rgb(1, 1, 1)
const GUIDE = rgb(GUIDE_RGB.r, GUIDE_RGB.g, GUIDE_RGB.b)
const FRAME = grayscale(FRAME_GRAY)
const FRAME_FILL = grayscale(LABEL_FILL_GRAY)

const PAGE_TITLES = ['letters', 'numbers and punctuation']

/** Maps the canonical frame (y down, origin at the marker box) to PDF space (y up, origin at page corner). */
class Canvas {
  readonly page: PDFPage
  private readonly ox: number
  private readonly oy: number
  private readonly pageHeight: number

  constructor(page: PDFPage, ox: number, oy: number, pageHeight: number) {
    this.page = page
    this.ox = ox
    this.oy = oy
    this.pageHeight = pageHeight
  }

  x(x: number) {
    return this.ox + x
  }

  y(y: number) {
    return this.pageHeight - (this.oy + y)
  }

  fill(r: Rect, color: Color = BLACK) {
    this.page.drawRectangle({ x: this.x(r.x), y: this.y(r.y + r.h), width: r.w, height: r.h, color })
  }

  stroke(r: Rect, color: Color = GUIDE, thickness = 0.75) {
    this.page.drawRectangle({
      x: this.x(r.x),
      y: this.y(r.y + r.h),
      width: r.w,
      height: r.h,
      borderColor: color,
      borderWidth: thickness,
    })
  }

  hline(x0: number, x1: number, y: number, thickness: number, dashed = false, color: Color = GUIDE) {
    this.page.drawLine({
      start: { x: this.x(x0), y: this.y(y) },
      end: { x: this.x(x1), y: this.y(y) },
      thickness,
      color,
      ...(dashed && { dashArray: [3, 2.5] }),
    })
  }

  text(s: string, x: number, baseline: number, font: PDFFont, size: number, gray: number) {
    this.page.drawText(s, { x: this.x(x), y: this.y(baseline), font, size, color: grayscale(gray) })
  }
}

function drawLabel(c: Canvas, info: CharInfo, label: Rect, font: PDFFont) {
  const charSize = 10
  const baseline = label.y + label.h - 4
  c.text(info.char, label.x + 4, baseline, font, charSize, LABEL_GRAY)
  if (info.hint) {
    const hintX = label.x + 4 + font.widthOfTextAtSize(info.char, charSize) + 4
    const room = label.x + label.w - 3 - hintX
    const size = Math.min(6, (6 * room) / font.widthOfTextAtSize(info.hint, 6))
    c.text(info.hint, hintX, baseline, font, size, LABEL_GRAY)
  }
}

/** Box outline, label-strip divider and guide lines for any cell or ligature box. */
function drawBoxFrame(c: Canvas, g: CellGeometry) {
  // Structure in gray: a lightly shaded label strip, the box border, and the line under the label.
  c.fill(g.label, FRAME_FILL)
  c.stroke(g.cell, FRAME, 0.6)
  c.hline(g.cell.x, g.cell.x + g.cell.w, g.label.y + g.label.h, 0.5, false, FRAME)
  // Writing guides in blue.
  const x0 = g.cell.x + INSET
  const x1 = g.cell.x + g.cell.w - INSET
  c.hline(x0, x1, g.guides.cap, 0.5)
  c.hline(x0, x1, g.guides.xHeight, 0.5, true)
  c.hline(x0, x1, g.guides.baseline, 1.25)
  c.hline(x0, x1, g.guides.descender, 0.5)
}

function drawCell(c: Canvas, index: number, info: CharInfo, font: PDFFont) {
  const g = cellGeometry(index)
  drawBoxFrame(c, g)
  drawLabel(c, info, g.label, font)
}

function drawLigatureBox(c: Canvas, box: LigatureBox, font: PDFFont) {
  const g = ligatureBoxGeometry(box)
  drawBoxFrame(c, g)
  const baseline = g.label.y + g.label.h - 4
  if (box.preset) c.text(box.preset, g.label.x + 4, baseline, font, 10, LABEL_GRAY)
  // Box number at the right, for matching boxes to the text typed in the app.
  const n = String(box.index + 1)
  c.text(n, g.label.x + g.label.w - 4 - font.widthOfTextAtSize(n, 6), baseline, font, 6, LABEL_GRAY)
}

export interface TemplateSheet {
  /** Letter set to print (ignored for ligature sheets). */
  style?: StyleId
  /** Only draw boxes for these characters (a redo sheet). Pages with none are skipped. */
  only?: string[]
  /** Print a ligature sheet instead, by sheet id (style × 8 + n; n = 0 common, 1–7 blank). */
  ligatureSheet?: number
  /** Ligature redo sheet: only draw these boxes (0-based). */
  boxes?: number[]
}

export interface TemplateOptions {
  /** Which sets to print, in order. Default: the full Regular template. */
  sheets?: TemplateSheet[]
}

export async function generateTemplatePdf(size: PageSizeId, options: TemplateOptions = {}): Promise<Uint8Array> {
  const sheets = options.sheets ?? [{ style: 'regular' }]
  const doc = await PDFDocument.create()
  doc.setTitle('Handwriting to Font — template')
  doc.setCreator('Handwriting to Font')
  doc.setProducer('Handwriting to Font')
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const paper = PAGE_SIZES[size]
  const origin = boxOriginOnPage(size)
  // Guard against future edits: the box must fit the paper with 0.5 in margins.
  if (origin.x < 0.5 * 72 - 0.01 || origin.y < 0.5 * 72 - 0.01 || BOX.width > paper.width) {
    throw new Error('Template box does not fit the page with 0.5 in margins')
  }

  /** A new page with corner markers, the page-ID strip and a two-line header. */
  function newPage(id: PageId, title: string, note: string): Canvas {
    const page = doc.addPage([paper.width, paper.height])
    const c = new Canvas(page, origin.x, origin.y, paper.height)
    // Corner markers; the top-left one has a white hole so the scanner can tell which way is up.
    for (const r of Object.values(MARKERS)) c.fill(r)
    c.fill({ ...MARKER_HOLE_RECT, x: MARKERS.tl.x + MARKER_HOLE_RECT.x, y: MARKERS.tl.y + MARKER_HOLE_RECT.y }, WHITE)
    // Page-ID strip: filled squares are 1s; empty ones get a light outline.
    encodePageId(id).forEach((bit, i) => {
      if (bit) c.fill(ID_SQUARES[i])
      else c.stroke(ID_SQUARES[i], GUIDE, 0.5)
    })
    // Extension squares (ligature sheets only).
    if (id.ext !== undefined) {
      encodeIdExt(id.ext).forEach((bit, i) => {
        if (bit) c.fill(ID_EXT_SQUARES[i])
        else c.stroke(ID_EXT_SQUARES[i], GUIDE, 0.5)
      })
    }
    const fit = (s: string, f: PDFFont, size: number) => Math.min(size, (size * BOX.width) / f.widthOfTextAtSize(s, size))
    c.text(title, HEADER.x, HEADER.titleBaseline, bold, fit(title, bold, HEADER.titleSize), HEADER_GRAY)
    c.text(note, HEADER.x, HEADER.noteBaseline, font, fit(note, font, HEADER.noteSize), HEADER_GRAY)
    return c
  }

  for (const sheet of sheets) {
    if (sheet.ligatureSheet !== undefined) {
      const id = sheet.ligatureSheet
      const only = sheet.boxes ? new Set(sheet.boxes) : null
      const boxes = ligatureBoxes(id).filter((b) => !only || only.has(b.index))
      if (!boxes.length) continue
      const kind = only ? '  ·  Redo sheet' : ''
      const title = `Handwriting to Font  ·  ${ligatureSheetName(id)}${kind}  ·  Template v${TEMPLATE_VERSION}`
      const style = ligatureSheetStyle(id)
      const inStyle = style === 'regular' ? '' : ` in your ${styleInfo(style).label.toLowerCase()} style`
      const note = only
        ? 'Print at 100%. Write only in the boxes shown; your new versions replace the earlier ones.'
        : sheetNumber(id) === COMMON_SHEET
          ? `Write each sequence${inStyle} the way your letters naturally join. Leave any you don’t want blank.`
          : `Write any letter sequence${inStyle}, or one letter’s alternate form. After uploading, type what each box holds.`
      const c = newPage(ligaturePageId(id, TEMPLATE_VERSION), title, note)
      for (const box of boxes) drawLigatureBox(c, box, font)
      continue
    }
    const styleId = sheet.style ?? 'regular'
    const only = sheet.only ? new Set(sheet.only) : null
    const style = styleInfo(styleId)
    for (const tp of TEMPLATE_PAGES) {
      const cells = tp.cells.map((info) => (info && (!only || only.has(info.char)) ? info : null))
      if (!cells.some(Boolean)) continue
      const set = styleId === 'regular' ? '' : `  ·  ${style.label} set`
      const kind = only ? '  ·  Redo sheet' : ''
      const title = `Handwriting to Font  ·  Page ${tp.index + 1} of ${TEMPLATE_PAGES.length} (${PAGE_TITLES[tp.index]})${set}${kind}  ·  Template v${TEMPLATE_VERSION}`
      const note = only
        ? 'Print at 100%. Write only in the boxes shown; your new letters replace the earlier ones.'
        : styleId === 'regular'
          ? 'Print at 100% / Actual size. Use a black felt-tip pen. Sit each character on the solid baseline.'
          : `Print at 100% / Actual size. Write every character in your ${style.label.toLowerCase()} style.`
      const c = newPage({ version: TEMPLATE_VERSION, pageIndex: pageIndexOf({ style: styleId, page: tp.index }) }, title, note)
      cells.forEach((info, i) => info && drawCell(c, i, info, font))
    }
  }
  if (doc.getPageCount() === 0) throw new Error('No characters to print')
  return doc.save()
}

/** Split a PDF into one single-page PDF per page, keeping the document info. */
export async function splitPdfPages(pdf: Uint8Array): Promise<Uint8Array[]> {
  const src = await PDFDocument.load(pdf)
  const out: Uint8Array[] = []
  for (let i = 0; i < src.getPageCount(); i++) {
    const doc = await PDFDocument.create()
    doc.setTitle(src.getTitle() ?? 'Handwriting to Font — template')
    doc.setCreator('Handwriting to Font')
    doc.setProducer('Handwriting to Font')
    const [page] = await doc.copyPages(src, [i])
    doc.addPage(page)
    out.push(await doc.save())
  }
  return out
}
