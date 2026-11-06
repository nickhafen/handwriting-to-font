// Runs the scan pipeline off the main thread so the page stays responsive.
import { ScanError } from '../core/scan/fiducials'
import { loadImage } from '../core/scan/load'
import { DEFAULT_SCAN_SETTINGS, processPage, type PageScan, type ScanSettings, type ScanStage } from '../core/scan/processPage'
import { DEFAULT_TRACE_OPTIONS, inkToImageData, traceToSvg, type TraceOptions } from '../core/trace/potrace'
import { potraceSvgToUnits } from '../core/trace/svgToContours'
import { fixWinding } from '../core/trace/winding'

export interface ScanRequest {
  id: number
  file: Blob
  settings?: ScanSettings
  trace?: TraceOptions
}

export type ScanResponse =
  | { id: number; type: 'stage'; stage: ScanStage }
  | { id: number; type: 'done'; scan: PageScan }
  | { id: number; type: 'error'; message: string; tips: string[] }

// Minimal worker-scope typing (the DOM and WebWorker type libraries conflict).
interface WorkerScope {
  onmessage: ((e: MessageEvent<ScanRequest>) => void) | null
  postMessage(message: ScanResponse, transfer: Transferable[]): void
}
const ctx = self as unknown as WorkerScope

/** Trace every non-empty cell into font-unit outlines with holes oriented correctly. */
async function traceCells(scan: PageScan, options: TraceOptions): Promise<void> {
  for (const cell of scan.cells) {
    if (cell.empty) continue
    const svg = await traceToSvg(inkToImageData(cell.ink, cell.width, cell.height), options)
    cell.contours = fixWinding(potraceSvgToUnits(svg))
  }
}

ctx.onmessage = async (e: MessageEvent<ScanRequest>) => {
  const { id, file, settings = DEFAULT_SCAN_SETTINGS, trace = DEFAULT_TRACE_OPTIONS } = e.data
  const post = (msg: ScanResponse, transfer: Transferable[] = []) => ctx.postMessage(msg, transfer)
  try {
    post({ id, type: 'stage', stage: 'loading' })
    const gray = await loadImage(file)
    const scan = processPage(gray, settings, (stage) => post({ id, type: 'stage', stage }))
    post({ id, type: 'stage', stage: 'tracing' })
    await traceCells(scan, trace)
    const buffers = scan.cells.flatMap((c) => [c.gray.buffer, c.ink.buffer]) as ArrayBuffer[]
    post({ id, type: 'done', scan }, buffers)
  } catch (err) {
    if (err instanceof ScanError) post({ id, type: 'error', message: err.message, tips: err.tips })
    else post({ id, type: 'error', message: `Couldn't read this image: ${err instanceof Error ? err.message : String(err)}`, tips: [] })
  }
}
