// Read the page-ID bit strip from the canonical page image.
import { ID_EXT_SQUARES, ID_SQUARE, ID_SQUARES, MARKERS, MARKER_SIZE, PX_PER_PT, type Rect } from '../template/layout'
import { decodeIdExt, decodePageId, type PageId } from '../template/pageIdCodec'
import type { GrayImage } from './image'

/** Mean gray value of the middle `frac` of a rectangle given in points. */
function meanIn(img: GrayImage, r: Rect, frac = 0.6): number {
  const cx = (r.x + r.w / 2) * PX_PER_PT
  const cy = (r.y + r.h / 2) * PX_PER_PT
  const hw = (r.w * frac * PX_PER_PT) / 2
  const hh = (r.h * frac * PX_PER_PT) / 2
  let sum = 0
  let n = 0
  for (let y = Math.round(cy - hh); y < Math.round(cy + hh); y++) {
    for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
      sum += img.data[y * img.width + x]
      n++
    }
  }
  return n ? sum / n : 255
}

export interface PageIdReading {
  bits: boolean[]
  id: PageId | null
  /** 0..1: how clearly the darkest "0" and lightest "1" separate. Low = unreliable. */
  confidence: number
}

export function readPageId(canonical: GrayImage): PageIdReading {
  // Black reference: inside a solid marker. White reference: blank paper between the top-left marker and the strip.
  const black = meanIn(canonical, MARKERS.br)
  const gapX = MARKER_SIZE + 0.15 * 72
  const white = meanIn(canonical, { x: gapX, y: ID_SQUARES[0].y, w: ID_SQUARES[0].x - 0.15 * 72 - gapX, h: ID_SQUARE })
  const cutoff = (black + white) / 2
  const means = ID_SQUARES.map((r) => meanIn(canonical, r))
  const extMeans = ID_EXT_SQUARES.map((r) => meanIn(canonical, r))
  const bits = means.map((m) => m < cutoff)
  const range = Math.max(1, white - black)
  const confidence = Math.min(...[...means, ...extMeans].map((m) => Math.abs(m - cutoff) / (range / 2)))
  const id = decodePageId(bits)
  const ext = decodeIdExt(extMeans.map((m) => m < cutoff))
  return { bits, id: id && { ...id, ext }, confidence: Math.max(0, Math.min(1, confidence)) }
}
