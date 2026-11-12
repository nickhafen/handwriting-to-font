// PDF scans -> one image per page, so the rest of the app only ever sees images.
// pdf.js is loaded on demand: it's large and only needed when someone drops a PDF.

/** Scanned pages are drawn at the template's own resolution. */
const RENDER_DPI = 300
/** Matches the scan loader's limit, so huge "page" sizes from phone scan apps stay manageable. */
const MAX_SIDE = 4000
const JPEG_QUALITY = 0.95

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

/** The name shown for one page of a PDF upload. */
export const pdfPageName = (pdfName: string, page: number, pages: number) => (pages === 1 ? pdfName : `${pdfName}, page ${page}`)

/** Render every page of a PDF to a JPEG file named after the PDF and page number. */
export async function pdfToImages(file: File): Promise<File[]> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  try {
    const doc = await task.promise
    const out: File[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(RENDER_DPI / 72, MAX_SIDE / Math.max(base.width, base.height))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      // intent 'print' avoids requestAnimationFrame, which stalls when the tab is hidden.
      await page.render({ canvas, viewport, intent: 'print' }).promise
      page.cleanup()
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not convert the page to an image'))), 'image/jpeg', JPEG_QUALITY),
      )
      out.push(new File([blob], pdfPageName(file.name, n, doc.numPages), { type: 'image/jpeg' }))
    }
    return out
  } finally {
    void task.destroy()
  }
}
