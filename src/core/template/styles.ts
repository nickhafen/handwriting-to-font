// Font styles (Regular, Bold, Italic, Bold Italic) and how each style's template
// pages are numbered in the page-ID strip. The page ID's 4-bit page index holds
// styleIndex × pagesPerStyle + page, so printed Regular pages (indices 0 and 1)
// keep working unchanged.
import { TEMPLATE_PAGES } from './charset'

export type StyleId = 'regular' | 'bold' | 'italic' | 'boldItalic'

export interface StyleInfo {
  id: StyleId
  /** Shown in the UI and used as the font's style name (nameID 2). */
  label: string
  weight: number
  italic: boolean
}

export const STYLES: StyleInfo[] = [
  { id: 'regular', label: 'Regular', weight: 400, italic: false },
  { id: 'bold', label: 'Bold', weight: 700, italic: false },
  { id: 'italic', label: 'Italic', weight: 400, italic: true },
  { id: 'boldItalic', label: 'Bold Italic', weight: 700, italic: true },
]

export const STYLE_IDS = STYLES.map((s) => s.id)
export const styleInfo = (id: StyleId): StyleInfo => STYLES.find((s) => s.id === id)!

export const PAGES_PER_STYLE = TEMPLATE_PAGES.length

/** Where a scanned page belongs: which style, and which page of that style's template. */
export interface Slot {
  style: StyleId
  page: number
}

export function pageIndexOf(slot: Slot): number {
  return STYLE_IDS.indexOf(slot.style) * PAGES_PER_STYLE + slot.page
}

/** Decode a page-ID page index; null if it isn't a known style/page. */
export function slotOf(pageIndex: number): Slot | null {
  const s = Math.floor(pageIndex / PAGES_PER_STYLE)
  if (s < 0 || s >= STYLES.length) return null
  return { style: STYLES[s].id, page: pageIndex % PAGES_PER_STYLE }
}

export const PAGE_NAMES = ['Page 1 (letters)', 'Page 2 (numbers and punctuation)']

export function slotLabel(slot: Slot): string {
  const page = PAGE_NAMES[slot.page] ?? `Page ${slot.page + 1}`
  return slot.style === 'regular' ? page : `${styleInfo(slot.style).label} set, ${page.charAt(0).toLowerCase()}${page.slice(1)}`
}
