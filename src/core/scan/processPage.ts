// Scan pipeline steps 2-7 for one page: markers -> warp -> page ID -> cells.
import { BOX, MARKER_CENTERS, PX_PER_PT, type Corner } from '../template/layout'
import type { PageId } from '../template/pageIdCodec'
import { DEFAULT_CELL_SETTINGS, extractAllCells, type CellResult, type CellSettings } from './cells'
import { DEFAULT_MARKER_SETTINGS, findMarkers, type MarkerSettings } from './fiducials'
import { solveHomography, warp, type Point2 } from './homography'
import type { GrayImage } from './image'
import { readPageId } from './pageId'

export interface ScanSettings {
  markers: MarkerSettings
  cells: CellSettings
}

export const DEFAULT_SCAN_SETTINGS: ScanSettings = { markers: DEFAULT_MARKER_SETTINGS, cells: DEFAULT_CELL_SETTINGS }

export type ScanStage = 'loading' | 'markers' | 'warping' | 'page-id' | 'cells' | 'tracing'

export interface PageScan {
  pageId: PageId | null
  idBits: boolean[]
  idConfidence: number
  /** Marker centers found in the uploaded image (for diagnostics). */
  corners: Record<Corner, Point2>
  /** All 56 grid cells; which character each one holds depends on the page. */
  cells: CellResult[]
}

export const CANONICAL_WIDTH = Math.round(BOX.width * PX_PER_PT)
export const CANONICAL_HEIGHT = Math.round(BOX.height * PX_PER_PT)

/** Warp the photo/scan so the template lands exactly on the canonical 300 DPI frame. */
export function toCanonical(gray: GrayImage, corners: Record<Corner, Point2>): GrayImage {
  const order: Corner[] = ['tl', 'tr', 'br', 'bl']
  const canon = order.map((c) => ({ x: MARKER_CENTERS[c].x * PX_PER_PT, y: MARKER_CENTERS[c].y * PX_PER_PT }))
  const H = solveHomography(canon, order.map((c) => corners[c]))
  return warp(gray, H, CANONICAL_WIDTH, CANONICAL_HEIGHT)
}

export function processPage(
  gray: GrayImage,
  settings: ScanSettings = DEFAULT_SCAN_SETTINGS,
  onStage: (stage: ScanStage) => void = () => {},
): PageScan {
  onStage('markers')
  const { corners } = findMarkers(gray, settings.markers)
  onStage('warping')
  const canonical = toCanonical(gray, corners)
  onStage('page-id')
  const id = readPageId(canonical)
  onStage('cells')
  const cells = extractAllCells(canonical, settings.cells)
  return { pageId: id.id, idBits: id.bits, idConfidence: id.confidence, corners, cells }
}
