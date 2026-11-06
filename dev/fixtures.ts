// Dev/test harness: makes synthetic scans and runs them through the real worker.
// Used by the Playwright tests; also handy by hand, e.g.
// /dev/fixtures.html?page=0&rotate=5&skew=0.03&shade=0.6&noise=10&format=jpeg
import { TEMPLATE_PAGES } from '../src/core/template/charset'
import { scanFile } from '../src/ui/scanClient'
import { makeFixture, type FixtureSpec } from '../tests/fixtures/synth/makeFixture'

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(b64: string, type: string): Blob {
  return new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type })
}

async function scanSummary(blob: Blob) {
  const t0 = performance.now()
  const scan = await scanFile(blob)
  const ms = Math.round(performance.now() - t0)
  const page = scan.pageId ? TEMPLATE_PAGES[scan.pageId.pageIndex] : undefined
  return {
    ms,
    pageId: scan.pageId,
    idConfidence: scan.idConfidence,
    cells: scan.cells.map((c) => ({
      index: c.index,
      char: page?.cells[c.index]?.char ?? null,
      empty: c.empty,
      touchesEdge: c.touchesEdge,
      inkArea: c.inkArea,
      yMin: c.yMinUnits,
      yMax: c.yMaxUnits,
      contours: c.contours.length,
    })),
  }
}

declare global {
  interface Window {
    hw: {
      makeFixture(spec: FixtureSpec): Promise<{ base64: string; type: string }>
      scan(base64: string, type: string): Promise<Awaited<ReturnType<typeof scanSummary>>>
    }
  }
}

window.hw = {
  async makeFixture(spec) {
    const blob = await makeFixture(spec)
    return { base64: await toBase64(blob), type: blob.type }
  },
  scan: (base64, type) => scanSummary(fromBase64(base64, type)),
}

// Manual use: render the fixture described by the query string.
const q = new URLSearchParams(location.search)
const status = document.getElementById('status')!
if (q.has('page')) {
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined)
  const spec: FixtureSpec = {
    pageIndex: Number(q.get('page')),
    rotate: num('rotate'),
    skew: num('skew'),
    shade: num('shade'),
    noise: num('noise'),
    shadow: q.has('shadow'),
    tint: q.has('tint'),
    format: q.get('format') === 'jpeg' ? 'jpeg' : 'png',
  }
  makeFixture(spec).then(async (blob) => {
    ;(document.getElementById('preview') as HTMLImageElement).src = URL.createObjectURL(blob)
    const r = await scanSummary(blob)
    status.textContent = `page ${JSON.stringify(r.pageId)}, ${r.cells.filter((c) => !c.empty).length} filled cells, ${r.ms} ms`
  })
} else status.textContent = 'Ready'
