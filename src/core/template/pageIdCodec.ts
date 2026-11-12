// Page-ID strip encoding: bits 0-3 = template version, bits 4-7 = page index.
// Bit i is the i-th square from the left; filled = 1. Ligature sheets also have
// extension squares holding the style they're written in (see ID_EXT_SQUARES).
import { ID_BITS, ID_EXT_BITS } from './layout'

export interface PageId {
  version: number
  pageIndex: number
  /** Extension value (ligature sheets: the style index; 0 = Regular, also on pages printed without the squares). */
  ext?: number
}

export function encodeIdExt(ext: number): boolean[] {
  if (ext < 0 || ext >= 1 << ID_EXT_BITS) throw new RangeError(`extension ${ext} must be 0-${(1 << ID_EXT_BITS) - 1}`)
  return Array.from({ length: ID_EXT_BITS }, (_, i) => ((ext >> i) & 1) === 1)
}

export const decodeIdExt = (bits: boolean[]): number => bits.reduce((acc, bit, i) => acc | ((bit ? 1 : 0) << i), 0)

export function encodePageId({ version, pageIndex }: PageId): boolean[] {
  if (version < 1 || version > 15) throw new RangeError(`template version ${version} must be 1-15`)
  if (pageIndex < 0 || pageIndex > 15) throw new RangeError(`page index ${pageIndex} must be 0-15`)
  const value = version | (pageIndex << 4)
  return Array.from({ length: ID_BITS }, (_, i) => ((value >> i) & 1) === 1)
}

/** Returns null when the bits can't be a valid ID (version 0 means nothing was read). */
export function decodePageId(bits: boolean[]): PageId | null {
  if (bits.length !== ID_BITS) return null
  const value = bits.reduce((acc, bit, i) => acc | ((bit ? 1 : 0) << i), 0)
  const version = value & 0x0f
  if (version === 0) return null
  return { version, pageIndex: value >> 4 }
}
