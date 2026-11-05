// Node-only synthetic template pages for unit tests: draws the template's
// black marks and light guides straight from layout.ts (no fonts needed),
// adds rectangular "ink" at known font-unit heights, then distorts it like a photo.
import {
  BOX,
  ID_SQUARES,
  MARKER_HOLE_RECT,
  MARKERS,
  TEMPLATE_VERSION,
  cellGeometry,
  unitsToY,
  type Rect,
} from '../../../src/core/template/layout'
import { encodePageId } from '../../../src/core/template/pageIdCodec'
import { solveHomography, warp, type Point2 } from '../../../src/core/scan/homography'
import { grayImage, type GrayImage } from '../../../src/core/scan/image'

export interface InkSpec {
  cell: number
  /** Ink spans these font units vertically (baseline = 0). */
  top: number
  bottom: number
}

const GUIDE_GRAY = 237 // the brightest channel of #A4DDED

export function renderPage(pageIndex: number, dpi: number, inks: InkSpec[], marginIn = 0.6): GrayImage {
  const s = dpi / 72
  const m = marginIn * dpi
  const W = Math.round(BOX.width * s + 2 * m)
  const H = Math.round(BOX.height * s + 2 * m)
  const img = grayImage(W, H, 255)
  const fill = (r: Rect, v: number) => {
    for (let y = Math.round(m + r.y * s); y < Math.round(m + (r.y + r.h) * s); y++)
      for (let x = Math.round(m + r.x * s); x < Math.round(m + (r.x + r.w) * s); x++) img.data[y * W + x] = v
  }
  for (const r of Object.values(MARKERS)) fill(r, 0)
  fill({ ...MARKER_HOLE_RECT }, 255)
  encodePageId({ version: TEMPLATE_VERSION, pageIndex }).forEach((bit, i) => bit && fill(ID_SQUARES[i], 0))
  for (let i = 0; i < 56; i++) {
    const g = cellGeometry(i)
    const line = (y: number) => fill({ x: g.cell.x, y, w: g.cell.w, h: 1 }, GUIDE_GRAY)
    ;[g.cell.y, g.cell.y + g.cell.h, g.label.y + g.label.h, g.guides.cap, g.guides.xHeight, g.guides.baseline, g.guides.descender].forEach(line)
    fill({ x: g.cell.x, y: g.cell.y, w: 1, h: g.cell.h }, GUIDE_GRAY)
  }
  for (const ink of inks) {
    const wr = cellGeometry(ink.cell).writing
    const y0 = unitsToY(wr, ink.top)
    const y1 = unitsToY(wr, ink.bottom)
    fill({ x: wr.x + wr.w * 0.3, y: y0, w: wr.w * 0.4, h: y1 - y0 }, 20)
  }
  return img
}

export interface PhotoOptions {
  /** Rotation in degrees (clockwise on screen). */
  rotate?: number
  /** Move each corner by up to this fraction of the image size (perspective). */
  skew?: number
  /** Brightness falls from 1 to this across the image. */
  shade?: number
  /** Background brightness around the page. */
  background?: number
  /** Gaussian-ish noise amplitude in gray levels. */
  noise?: number
  seed?: number
}

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

/** Warp the page into a larger "photo" with rotation, perspective, shading and noise. */
export function photograph(page: GrayImage, o: PhotoOptions = {}): GrayImage {
  const rand = rng(o.seed ?? 1)
  const pad = 0.12 * Math.max(page.width, page.height)
  const rot = ((o.rotate ?? 0) * Math.PI) / 180
  const cx = page.width / 2
  const cy = page.height / 2
  const src: Point2[] = [
    { x: 0, y: 0 },
    { x: page.width, y: 0 },
    { x: page.width, y: page.height },
    { x: 0, y: page.height },
  ]
  const turned = src.map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    return { x: dx * Math.cos(rot) - dy * Math.sin(rot), y: dx * Math.sin(rot) + dy * Math.cos(rot) }
  })
  const minX = Math.min(...turned.map((p) => p.x))
  const minY = Math.min(...turned.map((p) => p.y))
  const W = Math.round(Math.max(...turned.map((p) => p.x)) - minX + 2 * pad)
  const H = Math.round(Math.max(...turned.map((p) => p.y)) - minY + 2 * pad)
  const k = (o.skew ?? 0) * Math.min(W, H)
  const dst = turned.map((p) => ({ x: p.x - minX + pad + (rand() - 0.5) * 2 * k, y: p.y - minY + pad + (rand() - 0.5) * 2 * k }))
  const out = warp(page, solveHomography(dst, src), W, H, o.background ?? 70)
  const shade = o.shade ?? 1
  const noise = o.noise ?? 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const f = 1 - (1 - shade) * ((x / W + y / H) / 2)
      const n = noise ? (rand() + rand() + rand() - 1.5) * noise : 0
      const i = y * W + x
      out.data[i] = Math.max(0, Math.min(255, Math.round(out.data[i] * f + n)))
    }
  }
  return out
}
