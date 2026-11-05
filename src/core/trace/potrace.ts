// Thin wrapper around the Potrace WASM build. Works on the main thread or in a worker.
import { init, potrace } from 'esm-potrace-wasm'

export interface TraceOptions {
  /** Drop speckles up to this many pixels. */
  turdsize: number
  /** Corner threshold: 0 = all corners, 1.334 = no corners. */
  alphamax: number
  /** Curve optimization tolerance. */
  opttolerance: number
}

export const DEFAULT_TRACE_OPTIONS: TraceOptions = { turdsize: 2, alphamax: 1.0, opttolerance: 0.2 }

let ready: Promise<void> | null = null

/** Trace a black-on-white image into a full SVG document string. */
export async function traceToSvg(source: ImageBitmapSource, options: TraceOptions): Promise<string> {
  ready ??= init()
  await ready
  return potrace(source, {
    ...options,
    turnpolicy: 4, // "minority", Potrace's default
    opticurve: 1,
    pathonly: false,
    extractcolors: false,
    posterizelevel: 2,
    posterizationalgorithm: 0,
  })
}
