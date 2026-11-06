import { useState } from 'react'
import { CHARSET, TEMPLATE_PAGES } from '../core/template/charset'
import type { TemplateSheet } from '../core/template/generatePdf'
import { PAGE_SIZES, TEMPLATE_VERSION, type PageSizeId } from '../core/template/layout'
import { STYLES, styleInfo, type StyleId } from '../core/template/styles'
import { downloadBlob } from './fontFace'

const KNOWN = new Set(CHARSET.map((c) => c.char))

interface Props {
  /** Characters marked for redo, as "style:char". */
  redo: Set<string>
  onClearRedo: () => void
}

/** Marked characters grouped by style, in charset order. */
function redoByStyle(redo: Set<string>): { style: StyleId; chars: string[] }[] {
  return STYLES.map((s) => ({ style: s.id, chars: CHARSET.map((c) => c.char).filter((ch) => redo.has(`${s.id}:${ch}`)) })).filter(
    (g) => g.chars.length > 0,
  )
}

export function TemplateStep({ redo, onClearRedo }: Props) {
  const [size, setSize] = useState<PageSizeId>('letter')
  const [style, setStyle] = useState<StyleId>('regular')
  const [extra, setExtra] = useState('')
  const [extraStyle, setExtraStyle] = useState<StyleId>('regular')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function makePdf(sheets: TemplateSheet[]): Promise<Uint8Array | null> {
    setError(null)
    setBusy(true)
    try {
      // Loaded on demand: pdf-lib is large and only needed here.
      const { generateTemplatePdf } = await import('../core/template/generatePdf')
      return await generateTemplatePdf(size, { sheets })
    } catch (e) {
      setError(`Couldn't create the template: ${e}`)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function download(sheets: TemplateSheet[], name: string) {
    const pdf = await makePdf(sheets)
    if (pdf) downloadBlob(pdf.slice().buffer, `${name}-v${TEMPLATE_VERSION}-${size}.pdf`, 'application/pdf')
  }

  async function preview(sheets: TemplateSheet[]) {
    const pdf = await makePdf(sheets)
    if (!pdf) return
    const url = URL.createObjectURL(new Blob([pdf.slice().buffer], { type: 'application/pdf' }))
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const marked = redoByStyle(redo)
  const typed = [...new Set([...extra].filter((ch) => KNOWN.has(ch)))]
  const unknown = [...new Set([...extra].filter((ch) => ch.trim() && !KNOWN.has(ch)))]
  const redoSheets: TemplateSheet[] = [...marked.map((g) => ({ style: g.style, only: g.chars }))]
  if (typed.length) {
    const existing = redoSheets.find((s) => s.style === extraStyle)
    if (existing) existing.only = [...new Set([...existing.only!, ...typed])]
    else redoSheets.push({ style: extraStyle, only: typed })
  }
  const setName = style === 'regular' ? 'handwriting-template' : `handwriting-template-${style}`

  return (
    <section aria-labelledby="step-template">
      <h2 id="step-template">1. Print the template</h2>
      <div className="row">
        <fieldset className="row">
          <legend>Paper size</legend>
          {(Object.keys(PAGE_SIZES) as PageSizeId[]).map((id) => (
            <label key={id}>
              <input type="radio" name="paper" value={id} checked={size === id} onChange={() => setSize(id)} /> {PAGE_SIZES[id].label}
            </label>
          ))}
        </fieldset>
        <label>
          Set{' '}
          <select value={style} onChange={(e) => setStyle(e.target.value as StyleId)}>
            {STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <button onClick={() => download([{ style }], setName)} disabled={busy}>
          Download {style === 'regular' ? 'template' : `${styleInfo(style).label} template`} PDF
        </button>
        <button className="secondary" onClick={() => preview([{ style }])} disabled={busy}>
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
          Write each character inside its box. Sit letters on the <b>solid baseline</b>; tall letters reach the top line,
          and tails (g, p, y) drop toward the bottom line.
        </li>
        <li>
          Scan at <b>300 DPI</b>, or photograph each page <b>flat, in even light</b>, with all four black corner squares
          in the frame.
        </li>
      </ol>
      <p className="note">
        The template has {CHARSET.length} characters: page 1 is letters, page 2 is numbers and punctuation. Curly quotes
        are optional; if you leave them blank, the straight quotes are used instead. <b>Bold, Italic and Bold Italic</b>{' '}
        sets are optional too: write one with a thicker pen or in cursive, or let the app generate them from your Regular
        letters (step 4). Each set's pages are recognized automatically.
      </p>

      <details className="redo-panel" open={marked.length > 0 || undefined}>
        <summary>Redo a few characters</summary>
        <p className="note">
          Print a sheet with boxes only for the characters you want to redo. When you upload it, the new characters replace
          the old ones; everything else stays as it is. Mark characters in step 3, or type them here.
        </p>
        {marked.length > 0 ? (
          <p data-testid="redo-marked">
            Marked:{' '}
            {marked.map((g) => (
              <span key={g.style} className="redo-group">
                {g.style !== 'regular' && <b>{styleInfo(g.style).label}: </b>}
                <span className="redo-chars">{g.chars.join(' ')}</span>
              </span>
            ))}{' '}
            <button className="link" onClick={onClearRedo}>
              Clear marks
            </button>
          </p>
        ) : (
          <p className="note">No characters marked yet.</p>
        )}
        <div className="row">
          <label>
            Also redo <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. AgQ&" aria-label="Characters to redo" />
          </label>
          <label>
            in{' '}
            <select value={extraStyle} onChange={(e) => setExtraStyle(e.target.value as StyleId)} aria-label="Style for typed characters">
              {STYLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => download(redoSheets, 'handwriting-redo-sheet')} disabled={busy || redoSheets.length === 0}>
            Download redo sheet
          </button>
        </div>
        {unknown.length > 0 && <p className="warn">Not on the template: {unknown.join(' ')}</p>}
      </details>
    </section>
  )
}
