import { useState } from 'react'
import { CHARSET, TEMPLATE_PAGES } from '../core/template/charset'
import { PAGE_SIZES, TEMPLATE_VERSION, type PageSizeId } from '../core/template/layout'
import { downloadBlob } from './fontFace'

export function TemplateStep() {
  const [size, setSize] = useState<PageSizeId>('letter')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function makePdf(): Promise<Uint8Array | null> {
    setError(null)
    setBusy(true)
    try {
      // Loaded on demand: pdf-lib is large and only needed here.
      const { generateTemplatePdf } = await import('../core/template/generatePdf')
      return await generateTemplatePdf(size)
    } catch (e) {
      setError(`Couldn't create the template: ${e}`)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function onDownload() {
    const pdf = await makePdf()
    if (pdf) downloadBlob(pdf.slice().buffer, `handwriting-template-v${TEMPLATE_VERSION}-${size}.pdf`, 'application/pdf')
  }

  async function onPreview() {
    const pdf = await makePdf()
    if (!pdf) return
    const url = URL.createObjectURL(new Blob([pdf.slice().buffer], { type: 'application/pdf' }))
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <section aria-labelledby="step-template">
      <h2 id="step-template">1. Print the template</h2>
      <fieldset className="row">
        <legend>Paper size</legend>
        {(Object.keys(PAGE_SIZES) as PageSizeId[]).map((id) => (
          <label key={id}>
            <input type="radio" name="paper" value={id} checked={size === id} onChange={() => setSize(id)} />{' '}
            {PAGE_SIZES[id].label}
          </label>
        ))}
      </fieldset>
      <div className="row">
        <button onClick={onDownload} disabled={busy}>
          Download template PDF
        </button>
        <button className="secondary" onClick={onPreview} disabled={busy}>
          Preview in a new tab
        </button>
      </div>
      {error && (
        <p role="alert" className="bad">
          {error}
        </p>
      )}
      <ol className="instructions">
        <li>
          Print all {TEMPLATE_PAGES.length} pages <b>in color</b> at <b>100% / Actual size</b> (turn off “Fit to page” if
          you can). The light-blue guide lines are ignored when scanned; grayscale printing can turn them into ink.
        </li>
        <li>
          Use a <b>black felt-tip pen</b>. Ballpoint lines are often too thin and faint.
        </li>
        <li>
          Write each character inside its box. Sit letters on the <b>solid baseline</b>; tall letters reach the top
          line, and tails (g, p, y) drop toward the bottom line.
        </li>
        <li>
          Scan at <b>300 DPI</b>, or photograph each page <b>flat, in even light</b>, with all four black corner squares
          in the frame.
        </li>
      </ol>
      <p className="note">
        The template has {CHARSET.length} characters: page 1 is letters, page 2 is numbers and punctuation. Curly
        quotes are optional; if you leave them blank, the straight quotes are used instead.
      </p>
    </section>
  )
}
