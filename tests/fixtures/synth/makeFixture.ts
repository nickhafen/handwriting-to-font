// Browser-only synthetic scan generator for end-to-end tests. Renders the real
// template PDF, writes every character in a handwriting-like system font on the
// correct baseline, then distorts the page like a phone photo.
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { solveHomography, type Point2 } from '../../../src/core/scan/homography'
import { TEMPLATE_PAGES } from '../../../src/core/template/charset'
import { generateTemplatePdf } from '../../../src/core/template/generatePdf'
import { UNITS, boxOriginOnPage, cellGeometry, unitsToY, type CellGeometry } from '../../../src/core/template/layout'
import { ligatureBoxes, ligatureBoxGeometry } from '../../../src/core/template/ligatures'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface FixtureSpec {
  pageIndex: number
  /** Characters to leave blank (e.g. curly quotes, to exercise fallbacks). */
  skip?: string[]
  dpi?: number
  rotate?: number
  /** Random corner displacement as a fraction of the image size (perspective). */
  skew?: number
  /** Darkest lighting multiplier across the page (1 = even light). */
  shade?: number
  /** Add a soft round shadow. */
  shadow?: boolean
  noise?: number
  /** Warm paper tint, as a photo under indoor light would have. */
  tint?: boolean
  format?: 'png' | 'jpeg'
  /** Imitate a light pen: strokes fade from dark at the cap line to light gray at the baseline and below. */
  faint?: boolean
  /** Make a ligature sheet instead (0 = common, 1–7 = blank); `pageIndex` is then ignored. */
  ligatureSheet?: number
  /** What to write in ligature boxes, by box index (default: the common sheet's preset text). */
  ligatureTexts?: Record<number, string>
  /** Boxes (by the text written in them) that also get a stray pen stroke near their right edge. */
  stray?: string[]
  seed?: number
}

export const HANDWRITING_FONTS = '"Segoe Print", "Ink Free", "Comic Sans MS", "Bradley Hand", cursive'

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function renderTemplate(pageIndex: number, dpi: number, ligatureSheet?: number): Promise<HTMLCanvasElement> {
  const pdf = await generateTemplatePdf('letter', ligatureSheet === undefined ? {} : { sheets: [{ ligatureSheet }] })
  const doc = await pdfjs.getDocument({ data: pdf }).promise
  const page = await doc.getPage(ligatureSheet === undefined ? pageIndex + 1 : 1)
  const viewport = page.getViewport({ scale: dpi / 72 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  await page.render({ canvas, viewport, intent: 'print' }).promise
  return canvas
}

/** Write each character in its cell, sitting on the baseline, cap height on the cap line. */
/** What to write where: letter cells or ligature boxes. */
function boxesToWrite(spec: FixtureSpec): { g: CellGeometry; text: string }[] {
  if (spec.ligatureSheet !== undefined) {
    return ligatureBoxes(spec.ligatureSheet).flatMap((b) => {
      const text = spec.ligatureTexts?.[b.index] ?? b.preset
      return text ? [{ g: ligatureBoxGeometry(b), text }] : []
    })
  }
  const skip = new Set(spec.skip ?? [])
  return TEMPLATE_PAGES[spec.pageIndex].cells.flatMap((info, i) => (info && !skip.has(info.char) ? [{ g: cellGeometry(i), text: info.char }] : []))
}

/** A short vertical stroke near the right edge of a box, separate from the writing (which stays within the middle 80%). */
function drawStrayMarks(canvas: HTMLCanvasElement, dpi: number, items: { g: CellGeometry; text: string }[], stray: string[]) {
  const ctx = canvas.getContext('2d')!
  const s = dpi / 72
  const origin = boxOriginOnPage('letter')
  ctx.fillStyle = '#111'
  for (const { g, text } of items) {
    if (!stray.includes(text)) continue
    const x = (origin.x + g.writing.x + g.writing.w * 0.93) * s
    const top = (origin.y + g.guides.xHeight) * s
    const bottom = (origin.y + g.guides.baseline) * s
    ctx.fillRect(x, top, g.writing.w * 0.025 * s, bottom - top)
  }
}

function writeCharacters(canvas: HTMLCanvasElement, dpi: number, items: { g: CellGeometry; text: string }[], faint = false) {
  const ctx = canvas.getContext('2d')!
  const s = dpi / 72
  const origin = boxOriginOnPage('letter')
  ctx.fillStyle = '#111'
  ctx.textBaseline = 'alphabetic'
  // Size the font so a capital H reaches the cap line.
  ctx.font = `100px ${HANDWRITING_FONTS}`
  const hAscent = ctx.measureText('H').actualBoundingBoxAscent
  items.forEach(({ g, text }) => {
    const info = { char: text }
    const capPx = (unitsToY(g.writing, UNITS.baseline) - unitsToY(g.writing, UNITS.cap)) * s
    let size = (100 * capPx) / hAscent
    ctx.font = `${size}px ${HANDWRITING_FONTS}`
    const maxW = g.writing.w * s * 0.8
    // Shrink characters that wouldn't fit, as a writer would (some fonts draw "|" a full em tall).
    const m = ctx.measureText(info.char)
    const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight
    const roomUp = (unitsToY(g.writing, UNITS.baseline) - unitsToY(g.writing, UNITS.top)) * s * 0.92
    const roomDown = (unitsToY(g.writing, UNITS.bottom) - unitsToY(g.writing, UNITS.baseline)) * s * 0.92
    const fit = Math.min(1, maxW / inkW, roomUp / m.actualBoundingBoxAscent, roomDown / Math.max(1, m.actualBoundingBoxDescent))
    if (fit < 1) {
      size *= fit
      ctx.font = `${size}px ${HANDWRITING_FONTS}`
    }
    const mm = ctx.measureText(info.char)
    const cx = (origin.x + g.writing.x + g.writing.w / 2) * s
    const x = cx - (mm.actualBoundingBoxRight - mm.actualBoundingBoxLeft) / 2
    const y = (origin.y + g.guides.baseline) * s
    if (faint) {
      const grad = ctx.createLinearGradient(0, (origin.y + g.guides.cap) * s, 0, y)
      grad.addColorStop(0, '#1a1a1a')
      grad.addColorStop(1, '#b4b4b4')
      ctx.fillStyle = grad
    }
    ctx.fillText(info.char, x, y)
  })
}

/** Projective warp of RGBA pixels (bilinear), with background color outside the page. */
function photograph(src: HTMLCanvasElement, spec: FixtureSpec): HTMLCanvasElement {
  const rand = rng(spec.seed ?? 1)
  const sw = src.width
  const sh = src.height
  const srcData = src.getContext('2d')!.getImageData(0, 0, sw, sh).data
  const rot = ((spec.rotate ?? 0) * Math.PI) / 180
  const pad = 0.08 * Math.max(sw, sh)
  const corners: Point2[] = [
    { x: 0, y: 0 },
    { x: sw, y: 0 },
    { x: sw, y: sh },
    { x: 0, y: sh },
  ]
  const turned = corners.map((p) => {
    const dx = p.x - sw / 2
    const dy = p.y - sh / 2
    return { x: dx * Math.cos(rot) - dy * Math.sin(rot), y: dx * Math.sin(rot) + dy * Math.cos(rot) }
  })
  const minX = Math.min(...turned.map((p) => p.x))
  const minY = Math.min(...turned.map((p) => p.y))
  const W = Math.round(Math.max(...turned.map((p) => p.x)) - minX + 2 * pad)
  const H = Math.round(Math.max(...turned.map((p) => p.y)) - minY + 2 * pad)
  const k = (spec.skew ?? 0) * Math.min(W, H)
  const dst = turned.map((p) => ({ x: p.x - minX + pad + (rand() - 0.5) * 2 * k, y: p.y - minY + pad + (rand() - 0.5) * 2 * k }))
  const Hm = solveHomography(dst, corners) // output -> source

  const out = new ImageData(W, H)
  const o = out.data
  const shade = spec.shade ?? 1
  const noise = spec.noise ?? 0
  const tint = spec.tint ? [1, 0.95, 0.84] : [1, 1, 1]
  const shadow = spec.shadow ? { x: W * (0.3 + rand() * 0.4), y: H * (0.3 + rand() * 0.4), r: Math.min(W, H) * 0.35 } : null
  const bg = [92, 84, 76]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const w = Hm[6] * px + Hm[7] * py + Hm[8]
      const sx = (Hm[0] * px + Hm[1] * py + Hm[2]) / w - 0.5
      const sy = (Hm[3] * px + Hm[4] * py + Hm[5]) / w - 0.5
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      let light = 1 - (1 - shade) * ((x / W) * 0.6 + (y / H) * 0.4)
      if (shadow) {
        const d = Math.hypot(x - shadow.x, y - shadow.y) / shadow.r
        if (d < 1) light *= 1 - 0.35 * (1 - d * d)
      }
      const j = (y * W + x) * 4
      for (let c = 0; c < 3; c++) {
        let v: number
        if (x0 < 0 || y0 < 0 || x0 + 1 >= sw || y0 + 1 >= sh) v = bg[c]
        else {
          const fx = sx - x0
          const fy = sy - y0
          const i = (y0 * sw + x0) * 4 + c
          const top = srcData[i] + (srcData[i + 4] - srcData[i]) * fx
          const bot = srcData[i + sw * 4] + (srcData[i + sw * 4 + 4] - srcData[i + sw * 4]) * fx
          v = (top + (bot - top) * fy) * tint[c]
        }
        const n = noise ? (rand() + rand() + rand() - 1.5) * noise : 0
        o[j + c] = v * light + n
      }
      o[j + 3] = 255
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  canvas.getContext('2d')!.putImageData(out, 0, 0)
  return canvas
}

export async function makeFixture(spec: FixtureSpec): Promise<Blob> {
  const dpi = spec.dpi ?? 300
  await document.fonts.ready
  const page = await renderTemplate(spec.pageIndex, dpi, spec.ligatureSheet)
  const items = boxesToWrite(spec)
  writeCharacters(page, dpi, items, spec.faint)
  if (spec.stray) drawStrayMarks(page, dpi, items, spec.stray)
  const distorted = spec.rotate || spec.skew || spec.shade || spec.noise || spec.shadow || spec.tint
  const canvas = distorted ? photograph(page, spec) : page
  const type = spec.format === 'jpeg' ? 'image/jpeg' : 'image/png'
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, 0.88),
  )
}
