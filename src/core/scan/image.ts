// Plain image containers used by the scan pipeline (no DOM types).

/** 8-bit grayscale, row-major. 0 = black, 255 = white. */
export interface GrayImage {
  width: number
  height: number
  data: Uint8Array
}

/** Binary mask, row-major. 1 = ink, 0 = paper. */
export interface BinaryImage {
  width: number
  height: number
  data: Uint8Array
}

export function grayImage(width: number, height: number, fill = 255): GrayImage {
  return { width, height, data: new Uint8Array(width * height).fill(fill) }
}

/**
 * RGBA -> gray using the BRIGHTEST channel. Light-blue guide lines (#A4DDED)
 * come out nearly white (237) while black ink stays dark, so guides drop out
 * when thresholded. Ordinary luminance would make them a darker 0.82 gray.
 */
export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): GrayImage {
  const out = new Uint8Array(width * height)
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    const r = rgba[j]
    const g = rgba[j + 1]
    const b = rgba[j + 2]
    out[i] = r > g ? (r > b ? r : b) : g > b ? g : b
  }
  return { width, height, data: out }
}

/** Shrink by an integer factor, averaging each k×k block. */
export function downscale(img: GrayImage, k: number): GrayImage {
  if (k <= 1) return img
  const w = Math.floor(img.width / k)
  const h = Math.floor(img.height / k)
  const out = new Uint8Array(w * h)
  const n = k * k
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let dy = 0; dy < k; dy++) {
        const row = (y * k + dy) * img.width + x * k
        for (let dx = 0; dx < k; dx++) sum += img.data[row + dx]
      }
      out[y * w + x] = Math.round(sum / n)
    }
  }
  return { width: w, height: h, data: out }
}

/** Copy a rectangle out of an image; pixels outside the source are white. */
export function crop(img: GrayImage, x0: number, y0: number, w: number, h: number): GrayImage {
  const out = new Uint8Array(w * h).fill(255)
  for (let y = 0; y < h; y++) {
    const sy = y0 + y
    if (sy < 0 || sy >= img.height) continue
    for (let x = 0; x < w; x++) {
      const sx = x0 + x
      if (sx < 0 || sx >= img.width) continue
      out[y * w + x] = img.data[sy * img.width + sx]
    }
  }
  return { width: w, height: h, data: out }
}

/** The value at fraction `q` (0..1) of the sorted pixel values, via a histogram. */
export function percentile(img: GrayImage, q: number): number {
  const hist = new Uint32Array(256)
  for (const v of img.data) hist[v]++
  const target = q * (img.data.length - 1)
  let seen = 0
  for (let v = 0; v < 256; v++) {
    seen += hist[v]
    if (seen > target) return v
  }
  return 255
}
