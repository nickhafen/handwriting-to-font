// Dev only: run a ./samples image through the real worker pipeline and show each
// cell's grayscale crop next to its ink mask. Usage:
//   /dev/inspect.html?sample=grayscale%20p1%20(shadow).jpg&only=mnsuz
import { TEMPLATE_PAGES } from '../src/core/template/charset'
import { scanFile } from '../src/ui/scanClient'

const q = new URLSearchParams(location.search)
const name = q.get('sample') ?? ''
const only = q.get('only')
const status = document.getElementById('status')!
const grid = document.getElementById('grid')!

function draw(w: number, h: number, px: (i: number) => number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const v = px(i)
    img.data.set([v, v, v, 255], i * 4)
  }
  ctx.putImageData(img, 0, 0)
  return c
}

const blob = await (await fetch(`${import.meta.env.BASE_URL}__samples/${encodeURIComponent(name)}`)).blob()
const scan = await scanFile(blob)
const page = scan.pageId ? TEMPLATE_PAGES[scan.pageId.pageIndex] : undefined
;(window as unknown as { scan: unknown }).scan = scan
status.textContent = `${name}: page ${JSON.stringify(scan.pageId)} (confidence ${scan.idConfidence.toFixed(2)})`
for (const cell of scan.cells) {
  const ch = page?.cells[cell.index]?.char ?? `#${cell.index}`
  if (only && !only.includes(ch)) continue
  const fig = document.createElement('figure')
  fig.dataset.char = ch
  fig.dataset.ink = String(cell.inkArea)
  fig.append(
    draw(cell.width, cell.height, (i) => cell.gray[i]),
    draw(cell.width, cell.height, (i) => (cell.ink[i] ? 0 : 255)),
  )
  const cap = document.createElement('figcaption')
  cap.textContent = `${ch} · ink ${cell.inkArea}${cell.empty ? ' · empty' : ''}`
  fig.append(cap)
  grid.append(fig)
}
