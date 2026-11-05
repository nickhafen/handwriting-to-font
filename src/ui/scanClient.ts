// Main-thread wrapper around the pipeline worker: one promise per scanned file.
import type { PageScan, ScanStage } from '../core/scan/processPage'
import type { ScanRequest, ScanResponse } from '../workers/pipeline.worker'

export class ScanFailure extends Error {
  readonly tips: string[]
  constructor(message: string, tips: string[]) {
    super(message)
    this.tips = tips
  }
}

interface Pending {
  resolve: (scan: PageScan) => void
  reject: (err: ScanFailure) => void
  onStage: (stage: ScanStage) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/pipeline.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<ScanResponse>) => {
    const msg = e.data
    const p = pending.get(msg.id)
    if (!p) return
    if (msg.type === 'stage') p.onStage(msg.stage)
    else {
      pending.delete(msg.id)
      if (msg.type === 'done') p.resolve(msg.scan)
      else p.reject(new ScanFailure(msg.message, msg.tips))
    }
  }
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new ScanFailure(`The image processor crashed: ${e.message}`, []))
    pending.clear()
    worker = null
  }
  return worker
}

export function scanFile(file: Blob, onStage: (stage: ScanStage) => void = () => {}): Promise<PageScan> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onStage })
    getWorker().postMessage({ id, file } satisfies ScanRequest)
  })
}
