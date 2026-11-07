// Dev-only page: generates the template PDF and rasterizes it with pdf.js so
// it can be inspected without a PDF viewer. Usage: /dev/render-template.html?size=a4&dpi=100&style=bold&only=AgQ
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { generateTemplatePdf } from '../src/core/template/generatePdf'
import type { PageSizeId } from '../src/core/template/layout'
import type { StyleId } from '../src/core/template/styles'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const params = new URLSearchParams(location.search)
const size = (params.get('size') ?? 'letter') as PageSizeId
const dpi = Number(params.get('dpi') ?? 100)
const only = params.get('page')
const style = (params.get('style') ?? 'regular') as StyleId
const chars = params.get('only')

const lig = params.get('lig')
const bytes = await generateTemplatePdf(size, {
  sheets: [lig !== null ? { ligatureSheet: Number(lig) } : { style, ...(chars ? { only: [...chars] } : {}) }],
})
const doc = await pdfjs.getDocument({ data: bytes }).promise
for (let n = 1; n <= doc.numPages; n++) {
  if (only && Number(only) !== n) continue
  const page = await doc.getPage(n)
  const viewport = page.getViewport({ scale: dpi / 72 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  document.body.append(canvas)
  // intent 'print' avoids requestAnimationFrame, which stalls when the tab is hidden.
  await page.render({ canvas, viewport, intent: 'print' }).promise
}
document.getElementById('status')!.textContent = `${size}, ${doc.numPages} pages at ${dpi} DPI`
