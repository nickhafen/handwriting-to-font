// Potrace settings, kept apart from potrace.ts so importing them doesn't pull in the WASM module.
export interface TraceOptions {
  /** Drop speckles up to this many pixels. */
  turdsize: number
  /** Corner threshold: 0 = all corners, 1.334 = no corners. */
  alphamax: number
  /** Curve optimization tolerance. */
  opttolerance: number
}

export const DEFAULT_TRACE_OPTIONS: TraceOptions = { turdsize: 2, alphamax: 1.0, opttolerance: 0.2 }
