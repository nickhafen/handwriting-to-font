// File -> grayscale image. The one scan module that uses browser APIs
// (createImageBitmap / OffscreenCanvas), which also work inside a Web Worker.
import { rgbaToGray, type GrayImage } from './image'

export const MAX_SIDE = 4000

export async function loadImage(file: Blob, maxSide = MAX_SIDE): Promise<GrayImage> {
  // 'from-image' applies the photo's EXIF rotation.
  let bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  if (scale < 1) {
    const resizeWidth = Math.round(bitmap.width * scale)
    const resizeHeight = Math.round(bitmap.height * scale)
    bitmap.close()
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth, resizeHeight, resizeQuality: 'high' })
  }
  const { width, height } = bitmap
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D is not available')
  ctx.fillStyle = '#fff' // transparent PNG areas become paper, not black
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return rgbaToGray(ctx.getImageData(0, 0, width, height).data, width, height)
}
