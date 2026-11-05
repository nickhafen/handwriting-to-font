// Projective transforms: solve from 4 point pairs (DLT) and warp images.
import type { GrayImage } from './image'

export interface Point2 {
  x: number
  y: number
}

/** 3×3 matrix, row-major, with H[8] normalized to 1. */
export type Homography = Float64Array

/** Solve A·x = b in place by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    if (Math.abs(A[pivot][col]) < 1e-12) throw new Error('Degenerate point configuration')
    ;[A[col], A[pivot]] = [A[pivot], A[col]]
    ;[b[col], b[pivot]] = [b[pivot], b[col]]
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col]
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c]
      b[r] -= f * b[col]
    }
  }
  const x = new Array<number>(n)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c]
    x[r] = s / A[r][r]
  }
  return x
}

/** The homography H with H·src[i] ≅ dst[i] for 4 point pairs. */
export function solveHomography(src: Point2[], dst: Point2[]): Homography {
  if (src.length !== 4 || dst.length !== 4) throw new Error('Need exactly 4 point pairs')
  // Normalize both point sets for numerical stability (Hartley).
  const norm = (pts: Point2[]) => {
    const mx = pts.reduce((s, p) => s + p.x, 0) / 4
    const my = pts.reduce((s, p) => s + p.y, 0) / 4
    const d = pts.reduce((s, p) => s + Math.hypot(p.x - mx, p.y - my), 0) / 4 || 1
    const s = Math.SQRT2 / d
    return { T: Float64Array.from([s, 0, -s * mx, 0, s, -s * my, 0, 0, 1]), pts: pts.map((p) => ({ x: s * (p.x - mx), y: s * (p.y - my) })) }
  }
  const a = norm(src)
  const b = norm(dst)
  const A: number[][] = []
  const rhs: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = a.pts[i]
    const { x: u, y: v } = b.pts[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    rhs.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    rhs.push(v)
  }
  const h = solve(A, rhs)
  const Hn = Float64Array.from([...h, 1])
  // H = Tb⁻¹ · Hn · Ta
  return normalize(multiply(invert(b.T), multiply(Hn, a.T)))
}

export function multiply(A: Float64Array, B: Float64Array): Float64Array {
  const C = new Float64Array(9)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]
  return C
}

export function invert(m: Float64Array): Float64Array {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-15) throw new Error('Matrix is not invertible')
  const inv = Float64Array.from([
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ])
  for (let k = 0; k < 9; k++) inv[k] /= det
  return inv
}

function normalize(m: Float64Array): Homography {
  const s = m[8]
  return m.map((v) => v / s) as Homography
}

export function apply(H: Homography, p: Point2): Point2 {
  const w = H[6] * p.x + H[7] * p.y + H[8]
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w }
}

/**
 * Build an output image of `width`×`height` where each output pixel (x, y)
 * samples `src` at H·(x, y) with bilinear interpolation. H maps OUTPUT -> SOURCE
 * coordinates (pixel centers at integer + 0.5). Outside the source gets `outside` (default white).
 */
export function warp(src: GrayImage, H: Homography, width: number, height: number, outside = 255): GrayImage {
  const out = new Uint8Array(width * height)
  const { width: sw, height: sh, data } = src
  for (let y = 0; y < height; y++) {
    const py = y + 0.5
    for (let x = 0; x < width; x++) {
      const px = x + 0.5
      const w = H[6] * px + H[7] * py + H[8]
      const sx = (H[0] * px + H[1] * py + H[2]) / w - 0.5
      const sy = (H[3] * px + H[4] * py + H[5]) / w - 0.5
      if (sx < -0.5 || sy < -0.5 || sx > sw - 0.5 || sy > sh - 0.5) {
        out[y * width + x] = outside
        continue
      }
      // Clamp at the edges so border pixels can still be sampled.
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)))
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)))
      const x1 = Math.min(sw - 1, x0 + 1)
      const y1 = Math.min(sh - 1, y0 + 1)
      const fx = Math.max(0, Math.min(1, sx - x0))
      const fy = Math.max(0, Math.min(1, sy - y0))
      const r0 = y0 * sw
      const r1 = y1 * sw
      const top = data[r0 + x0] + (data[r0 + x1] - data[r0 + x0]) * fx
      const bot = data[r1 + x0] + (data[r1 + x1] - data[r1 + x0]) * fx
      out[y * width + x] = Math.round(top + (bot - top) * fy)
    }
  }
  return { width, height, data: out }
}
