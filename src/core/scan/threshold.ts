// Thresholding: gray -> binary ink mask.
import type { BinaryImage, GrayImage } from './image'

/**
 * Bradley adaptive threshold using an integral image. A pixel is ink when it
 * is more than `t` darker than the mean of the window around it. Handles the
 * uneven lighting and shadows of phone photos, where one global cutoff fails.
 *
 * @param window side of the averaging window in pixels (use ~1/8 of the image)
 * @param t      0.15 = ink must be 15% darker than its surroundings
 */
export function adaptiveThreshold(img: GrayImage, window: number, t = 0.15): BinaryImage {
  const { width: w, height: h, data } = img
  // Integral image with a zero row/column; Float64 avoids overflow on big images.
  const W = w + 1
  const integral = new Float64Array(W * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += data[y * w + x]
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + rowSum
    }
  }
  const half = Math.max(1, Math.floor(window / 2))
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(h, y + half + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(w, x + half + 1)
      const sum = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0]
      const count = (y1 - y0) * (x1 - x0)
      out[y * w + x] = data[y * w + x] * count < sum * (1 - t) ? 1 : 0
    }
  }
  return { width: w, height: h, data: out }
}

/** Simple global threshold: ink where value < cutoff. */
export function globalThreshold(img: GrayImage, cutoff: number): BinaryImage {
  const out = new Uint8Array(img.data.length)
  for (let i = 0; i < out.length; i++) out[i] = img.data[i] < cutoff ? 1 : 0
  return { width: img.width, height: img.height, data: out }
}
