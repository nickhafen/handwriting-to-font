// Connected-component labeling (8-connected) with per-component statistics.
import type { BinaryImage } from './image'

export interface Component {
  /** Label in the label image (1-based). */
  label: number
  area: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Centroid. */
  cx: number
  cy: number
  /** Second central moments, for orientation-independent shape tests. */
  mxx: number
  myy: number
  mxy: number
}

export interface Labeling {
  /** Per-pixel label; 0 = background. */
  labels: Int32Array
  components: Component[]
}

/** Label ink pixels into 8-connected components using an explicit stack (no recursion). */
export function labelComponents(img: BinaryImage): Labeling {
  const { width: w, height: h, data } = img
  const labels = new Int32Array(w * h)
  const components: Component[] = []
  const stack = new Int32Array(w * h)

  for (let start = 0; start < data.length; start++) {
    if (!data[start] || labels[start]) continue
    const label = components.length + 1
    let sp = 0
    stack[sp++] = start
    labels[start] = label
    let area = 0
    let sx = 0
    let sy = 0
    let sxx = 0
    let syy = 0
    let sxy = 0
    let minX = w
    let minY = h
    let maxX = -1
    let maxY = -1
    while (sp > 0) {
      const p = stack[--sp]
      const x = p % w
      const y = (p - x) / w
      area++
      sx += x
      sy += y
      sxx += x * x
      syy += y * y
      sxy += x * y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue
          const q = ny * w + nx
          if (data[q] && !labels[q]) {
            labels[q] = label
            stack[sp++] = q
          }
        }
      }
    }
    const cx = sx / area
    const cy = sy / area
    components.push({
      label,
      area,
      minX,
      minY,
      maxX,
      maxY,
      cx,
      cy,
      mxx: sxx / area - cx * cx,
      myy: syy / area - cy * cy,
      mxy: sxy / area - cx * cy,
    })
  }
  return { labels, components }
}

/** Eigenvalues of the component's covariance, largest first. */
export function principalVariances(c: Component): [number, number] {
  const tr = c.mxx + c.myy
  const det = c.mxx * c.myy - c.mxy * c.mxy
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det))
  return [tr / 2 + disc, tr / 2 - disc]
}

/** Remove components smaller than `minArea` pixels. Returns a new image and the remaining components. */
export function removeSpecks(img: BinaryImage, minArea: number): { image: BinaryImage; components: Component[] } {
  const { labels, components } = labelComponents(img)
  const keep = new Uint8Array(components.length + 1)
  for (const c of components) keep[c.label] = c.area >= minArea ? 1 : 0
  const out = new Uint8Array(img.data.length)
  for (let i = 0; i < out.length; i++) out[i] = keep[labels[i]]
  return { image: { width: img.width, height: img.height, data: out }, components: components.filter((c) => keep[c.label]) }
}
