// Main-thread wrapper around the pipeline worker: one promise per request.
import type { InkAdjust } from '../core/scan/adjust'
import type { CellResult } from '../core/scan/cells'
import type { PageScan, ScanStage } from '../core/scan/processPage'
import type { CellCrop, WorkerRequest, WorkerResponse } from '../workers/pipeline.worker'

export class ScanFailure extends Error {
  readonly tips: string[]
  constructor(message: string, tips: string[]) {
    super(message)
    this.tips = tips
  }
}

interface Pending {
  resolve: (value: PageScan | CellResult[]) => void
  reject: (err: ScanFailure) => void
  onStage?: (stage: ScanStage) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/pipeline.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data
    const p = pending.get(msg.id)
    if (!p) return
    if (msg.type === 'stage') {
      p.onStage?.(msg.stage)
      return
    }
    pending.delete(msg.id)
    if (msg.type === 'done') p.resolve(msg.scan)
    else if (msg.type === 'retraced') p.resolve(msg.cells)
    else p.reject(new ScanFailure(msg.message, msg.tips))
  }
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new ScanFailure(`The image processor crashed: ${e.message}`, []))
    pending.clear()
    worker = null
  }
  return worker
}

function request<T extends PageScan | CellResult[]>(msg: WorkerRequest, onStage?: (s: ScanStage) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.set(msg.id, { resolve: resolve as Pending['resolve'], reject, onStage })
    getWorker().postMessage(msg)
  })
}

export function scanFile(file: Blob, adjust?: InkAdjust, onStage: (stage: ScanStage) => void = () => {}): Promise<PageScan> {
  return request<PageScan>({ id: nextId++, kind: 'scan', file, adjust }, onStage)
}

/** Re-threshold and re-trace cells from their stored grayscale crops with new ink settings. */
export function retraceCells(cells: CellCrop[], adjust: InkAdjust): Promise<CellResult[]> {
  // Send copies: the caller keeps its crops for later adjustments.
  const copies = cells.map((c) => ({ ...c, gray: c.gray.slice() }))
  return request<CellResult[]>({ id: nextId++, kind: 'retrace', cells: copies, adjust })
}
