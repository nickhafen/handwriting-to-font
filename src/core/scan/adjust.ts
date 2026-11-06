// User-facing ink controls, shared by the "all letters" panel and per-letter overrides.
import { DEFAULT_TRACE_OPTIONS, type TraceOptions } from '../trace/options'
import { DEFAULT_CELL_SETTINGS, type CellSettings } from './cells'

export interface InkAdjust {
  /** 0-100: how faint a stroke can be and still count as ink (when connected to darker ink). */
  sensitivity: number
  /** Pixels (at 300 DPI) to thicken (+) or thin (−) every stroke on each side. */
  thickness: number
  /** 0-100: how much Potrace rounds corners. */
  smoothing: number
}

export const DEFAULT_ADJUST: InkAdjust = { sensitivity: 70, thickness: 0, smoothing: 75 }

export const ADJUST_RANGES = {
  sensitivity: { min: 0, max: 100, step: 5 },
  thickness: { min: -2, max: 4, step: 0.5 },
  smoothing: { min: 0, max: 100, step: 5 },
} as const

/** Sensitivity 0..100 -> weak-ink cutoff 0.62..0.88 of paper brightness. Guides (~0.93) stay out. */
export function toCellSettings(a: InkAdjust, base: CellSettings = DEFAULT_CELL_SETTINGS): CellSettings {
  return { ...base, weakRatio: 0.62 + (a.sensitivity / 100) * 0.26, thickness: a.thickness }
}

/** Smoothing 0..100 -> Potrace alphamax 0.2..1.3 (default 75 ≈ Potrace's usual 1.0). */
export function toTraceOptions(a: InkAdjust, base: TraceOptions = DEFAULT_TRACE_OPTIONS): TraceOptions {
  return { ...base, alphamax: 0.2 + (a.smoothing / 100) * 1.1 }
}

export function sameAdjust(a: InkAdjust, b: InkAdjust): boolean {
  return a.sensitivity === b.sensitivity && a.thickness === b.thickness && a.smoothing === b.smoothing
}
