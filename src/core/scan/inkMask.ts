// Turning a cell's grayscale crop into an ink mask: hysteresis thresholding
// (keeps faint stroke sections that connect to dark ones) and stroke-thickness
// adjustment (grow or shrink the mask by a distance in pixels).
import { labelComponents } from './components'
import type { BinaryImage, GrayImage } from './image'

export interface HysteresisOptions {
  /** Pixels darker than this are definitely ink and anchor a stroke. */
  strongCut: number
  /** Pixels darker than this are ink if they connect to a strong pixel. */
  weakCut: number
  /** Stricter weak cutoff inside `bandRows`, so growth can't run along a printed guide line. */
  bandCut?: number
  /** Rows (true = guide band) where `bandCut` applies instead of `weakCut`. */
  bandRows?: boolean[]
  /**
   * Per-row ceiling for both cutoffs (Infinity = none). Set just below the darkness of a
   * printed line that came out dark (grayscale prints), so neither the line itself nor
   * growth along it counts as ink.
   */
  rowLimit?: number[]
}

/**
 * Hysteresis threshold: keep every weak-ink component that contains at least
 * one strong-ink pixel. Faint parts of a stroke survive when they connect to a
 * dark part; isolated faint smudges and guide lines don't.
 */
export function hysteresis(img: GrayImage, o: HysteresisOptions): BinaryImage {
  const { width: w, height: h, data } = img
  const weak = new Uint8Array(w * h)
  const strongAt = new Float32Array(h)
  for (let y = 0; y < h; y++) {
    const limit = o.rowLimit?.[y] ?? Infinity
    const strong = Math.min(o.strongCut, limit)
    const band = o.bandRows?.[y] && o.bandCut !== undefined ? Math.min(o.bandCut, o.weakCut) : o.weakCut
    const cut = Math.min(Math.max(band, strong), limit)
    strongAt[y] = strong
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      weak[i] = data[i] < cut ? 1 : 0
    }
  }
  const { labels, components } = labelComponents({ width: w, height: h, data: weak })
  const keep = new Uint8Array(components.length + 1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (data[i] < strongAt[y] && labels[i]) keep[labels[i]] = 1
    }
  }
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = keep[labels[i]]
  return { width: w, height: h, data: out }
}

/**
 * Flatten uneven lighting: estimate the paper brightness around every pixel
 * (the brightest value in each block, spread to neighboring blocks so blocks
 * covered by ink still see paper, then smoothed) and divide it out. A shadow
 * across a cell becomes white paper again; ink stays dark.
 */
export function normalizeBackground(img: GrayImage, block = 24): GrayImage {
  const { width: w, height: h, data } = img
  const bw = Math.ceil(w / block)
  const bh = Math.ceil(h / block)
  const bmax = new Float32Array(bw * bh)
  for (let y = 0; y < h; y++) {
    const by = Math.floor(y / block) * bw
    for (let x = 0; x < w; x++) {
      const b = by + Math.floor(x / block)
      if (data[y * w + x] > bmax[b]) bmax[b] = data[y * w + x]
    }
  }
  // Max over 3x3 blocks, then a 3x3 average for smooth transitions.
  const grid = (src: Float32Array, f: (vals: number[]) => number) => {
    const out = new Float32Array(src.length)
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const vals: number[] = []
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy
            const xx = x + dx
            if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) vals.push(src[yy * bw + xx])
          }
        out[y * bw + x] = f(vals)
      }
    }
    return out
  }
  const bg = grid(
    grid(bmax, (v) => Math.max(...v)),
    (v) => v.reduce((s, a) => s + a, 0) / v.length,
  )
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    // Bilinear interpolation between block centers.
    const fy = Math.max(0, Math.min(bh - 1, (y + 0.5) / block - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(bh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(bw - 1, (x + 0.5) / block - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(bw - 1, x0 + 1)
      const tx = fx - x0
      const top = bg[y0 * bw + x0] * (1 - tx) + bg[y0 * bw + x1] * tx
      const bot = bg[y1 * bw + x0] * (1 - tx) + bg[y1 * bw + x1] * tx
      const paper = Math.max(1, top * (1 - ty) + bot * ty)
      out[y * w + x] = Math.min(255, Math.round((data[y * w + x] * 255) / paper))
    }
  }
  return { width: w, height: h, data: out }
}

/**
 * Rows that look like a printed guide line: across most of the width, pixels
 * are faint (darker than `weakCut`) but not dark ink. Returned with a margin of
 * `pad` rows on each side. Handwriting almost never makes such a row; dashes and
 * underscores are dark, so they don't count.
 */
export function detectGuideRows(img: GrayImage, strongCut: number, weakCut: number, minFraction = 0.35, pad = 2): boolean[] {
  const { width: w, height: h, data } = img
  const rows = new Array<boolean>(h).fill(false)
  for (let y = 0; y < h; y++) {
    let faint = 0
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x]
      if (v < weakCut && v >= strongCut) faint++
    }
    if (faint >= minFraction * w) for (let k = y - pad; k <= y + pad; k++) if (k >= 0 && k < h) rows[k] = true
  }
  return rows
}

/**
 * Per-row ink-cutoff ceilings for printed guide lines that came out dark, as on a
 * grayscale print (where light blue becomes gray, sometimes almost as dark as ink).
 * For each row that looks like a printed line (see `detectGuideRows`), the line's
 * darkness is the median of its line-like pixels: darker than `weakCut` but not
 * dark-ink dark (below 0.75 × `strongCut`). That row and `pad` rows on each side
 * get a ceiling `margin` below it. Other rows get Infinity (no ceiling).
 * Pen strokes crossing the line are much darker than the line and survive.
 */
export function guideLineLimits(img: GrayImage, strongCut: number, weakCut: number, margin: number, minFraction = 0.35, pad = 2): number[] {
  const { width: w, height: h, data } = img
  const limits = new Array<number>(h).fill(Infinity)
  const floor = strongCut * 0.75
  const vals: number[] = []
  for (let y = 0; y < h; y++) {
    let faint = 0
    vals.length = 0
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x]
      if (v < weakCut && v >= strongCut) faint++
      if (v < weakCut && v >= floor) vals.push(v)
    }
    if (faint < minFraction * w) continue
    vals.sort((a, b) => a - b)
    const limit = vals[vals.length >> 1] - margin
    for (let k = Math.max(0, y - pad); k <= Math.min(h - 1, y + pad); k++) limits[k] = Math.min(limits[k], limit)
  }
  return limits
}

/**
 * Approximate Euclidean distance (chamfer 3-4, in pixels) from each pixel to
 * the nearest pixel where `target(i)` is true. Two passes, linear time.
 */
function chamferDistance(w: number, h: number, target: (i: number) => boolean): Float32Array {
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = target(i) ? 0 : INF
  const A = 1 // orthogonal step
  const B = 4 / 3 // diagonal step (3-4 chamfer, scaled so A = 1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + A)
      if (y > 0) {
        v = Math.min(v, d[i - w] + A)
        if (x > 0) v = Math.min(v, d[i - w - 1] + B)
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + B)
      }
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let v = d[i]
      if (x < w - 1) v = Math.min(v, d[i + 1] + A)
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + A)
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + B)
        if (x > 0) v = Math.min(v, d[i + w - 1] + B)
      }
      d[i] = v
    }
  }
  return d
}

/**
 * Thicken (amount > 0) or thin (amount < 0) every stroke by about `amount`
 * pixels on each side. 0 returns the mask unchanged.
 */
export function adjustThickness(mask: BinaryImage, amount: number): BinaryImage {
  if (!amount) return mask
  const { width: w, height: h, data } = mask
  const out = new Uint8Array(w * h)
  if (amount > 0) {
    const d = chamferDistance(w, h, (i) => data[i] === 1)
    for (let i = 0; i < out.length; i++) out[i] = d[i] <= amount ? 1 : 0
  } else {
    const d = chamferDistance(w, h, (i) => data[i] === 0)
    for (let i = 0; i < out.length; i++) out[i] = data[i] && d[i] > -amount ? 1 : 0
  }
  return { width: w, height: h, data: out }
}
