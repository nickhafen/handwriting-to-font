// Thin wrapper around the Potrace WASM build. Works on the main thread or in a
// worker as long as it's given ImageData (other inputs make the library reach
// for `document`, which workers don't have).
import { init, potrace } from 'esm-potrace-wasm'
import { DEFAULT_TRACE_OPTIONS, type TraceOptions } from './options'

export { DEFAULT_TRACE_OPTIONS, type TraceOptions } from './options'

let ready: Promise<void> | null = null

/** Black-on-white RGBA pixels from a 1 = ink mask. */
export function inkToImageData(ink: Uint8Array, width: number, height: number): ImageData {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < ink.length; i++) {
    const v = ink[i] ? 0 : 255
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v
    rgba[i * 4 + 3] = 255
  }
  return new ImageData(rgba, width, height)
}

/** Trace a black-on-white image into a full SVG document string. */
export async function traceToSvg(image: ImageData, options: TraceOptions = DEFAULT_TRACE_OPTIONS): Promise<string> {
  ready ??= init()
  await ready
  return potrace(image, {
    ...options,
    turnpolicy: 4, // "minority", Potrace's default
    opticurve: 1,
    pathonly: false,
    extractcolors: false,
    posterizelevel: 2,
    posterizationalgorithm: 0,
  })
}
