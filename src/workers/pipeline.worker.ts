// Runs the scan pipeline off the main thread so the page stays responsive.
import { DEFAULT_ADJUST, toCellSettings, toTraceOptions, type InkAdjust } from '../core/scan/adjust'
import { analyzeCell, type CellResult } from '../core/scan/cells'
import { ScanError } from '../core/scan/fiducials'
import { loadImage } from '../core/scan/load'
import { DEFAULT_SCAN_SETTINGS, processPage, type PageScan, type ScanStage } from '../core/scan/processPage'
import { inkToImageData, traceToSvg, type TraceOptions } from '../core/trace/potrace'
import { potraceSvgToUnits } from '../core/trace/svgToContours'
import { fixWinding } from '../core/trace/winding'

/** A grayscale cell crop sent back for re-processing with different ink settings. */
export interface CellCrop {
  index: number
  width: number
  height: number
  gray: Uint8Array
}

export type WorkerRequest =
  | { id: number; kind: 'scan'; file: Blob; adjust?: InkAdjust }
  | { id: number; kind: 'retrace'; cells: CellCrop[]; adjust: InkAdjust }

export type WorkerResponse =
  | { id: number; type: 'stage'; stage: ScanStage }
  | { id: number; type: 'done'; scan: PageScan }
  | { id: number; type: 'retraced'; cells: CellResult[] }
  | { id: number; type: 'error'; message: string; tips: string[] }

// Minimal worker-scope typing (the DOM and WebWorker type libraries conflict).
interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse, transfer: Transferable[]): void
}
const ctx = self as unknown as WorkerScope

/** Trace one cell into font-unit outlines with holes oriented correctly. */
async function traceCell(cell: CellResult, options: TraceOptions): Promise<void> {
  cell.contours = cell.empty ? [] : fixWinding(potraceSvgToUnits(await traceToSvg(inkToImageData(cell.ink, cell.width, cell.height), options)))
}

const buffersOf = (cells: CellResult[]) => cells.flatMap((c) => [c.gray.buffer, c.ink.buffer]) as ArrayBuffer[]

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  const { id } = req
  const post = (msg: WorkerResponse, transfer: Transferable[] = []) => ctx.postMessage(msg, transfer)
  try {
    if (req.kind === 'scan') {
      const adjust = req.adjust ?? DEFAULT_ADJUST
      post({ id, type: 'stage', stage: 'loading' })
      const gray = await loadImage(req.file)
      const settings = { ...DEFAULT_SCAN_SETTINGS, cells: toCellSettings(adjust) }
      const scan = processPage(gray, settings, (stage) => post({ id, type: 'stage', stage }))
      post({ id, type: 'stage', stage: 'tracing' })
      for (const cell of scan.cells) await traceCell(cell, toTraceOptions(adjust))
      post({ id, type: 'done', scan }, buffersOf(scan.cells))
    } else {
      const cellSettings = toCellSettings(req.adjust)
      const trace = toTraceOptions(req.adjust)
      const cells: CellResult[] = []
      for (const c of req.cells) {
        const cell = analyzeCell({ width: c.width, height: c.height, data: c.gray }, c.index, cellSettings)
        await traceCell(cell, trace)
        cells.push(cell)
      }
      post({ id, type: 'retraced', cells }, buffersOf(cells))
    }
  } catch (err) {
    if (err instanceof ScanError) post({ id, type: 'error', message: err.message, tips: err.tips })
    else post({ id, type: 'error', message: `Couldn't read this image: ${err instanceof Error ? err.message : String(err)}`, tips: [] })
  }
}
