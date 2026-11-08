import { useState } from 'react'
import { CHARSET, TEMPLATE_PAGES } from '../core/template/charset'
import type { TemplateSheet } from '../core/template/generatePdf'
import { PAGE_SIZES, TEMPLATE_VERSION, type PageSizeId } from '../core/template/layout'
import { BLANK_SHEETS, COMMON_SHEET } from '../core/template/ligatures'
import { STYLES, styleInfo, type StyleId } from '../core/template/styles'
import { downloadBlob } from './fontFace'
import { loadOnDemand, StalePageError } from './lazy'

const KNOWN = new Set(CHARSET.map((c) => c.char))

interface Props {
  /** Characters marked for redo, as "style:char". */
  redo: Set<string>
  onClearRedo: () => void
  /** Ligature sheets already uploaded (0 = common, 1–7 = blank). */
  ligatureSheetsUploaded: Set<number>
}

/** Marked characters grouped by style, in charset order. */
function redoByStyle(redo: Set<string>): { style: StyleId; chars: string[] }[] {
  return STYLES.map((s) => ({ style: s.id, chars: CHARSET.map((c) => c.char).filter((ch) => redo.has(`${s.id}:${ch}`)) })).filter(
    (g) => g.chars.length > 0,
  )
}

export function TemplateStep({ redo, onClearRedo, ligatureSheetsUploaded }: Props) {
  const firstFreeBlank = Array.from({ length: BLANK_SHEETS }, (_, i) => i + 1).find((n) => !ligatureSheetsUploaded.has(n)) ?? 1
  const [blankSheet, setBlankSheet] = useState(firstFreeBlank)
  const [size, setSize] = useState<PageSizeId>('letter')
  const [style, setStyle] = useState<StyleId>('regular')
  const [extra, setExtra] = useState('')
  const [extraStyle, setExtraStyle] = useState<StyleId>('regular')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null)

  async function makePdf(sheets: TemplateSheet[]): Promise<Uint8Array | null> {
    setError(null)
    setBusy(true)
    try {
      // Loaded on demand: pdf-lib is large and only needed here.
      const { generateTemplatePdf } = await loadOnDemand(() => import('../core/template/generatePdf'))
      return await generateTemplatePdf(size, { sheets })
    } catch (e) {
      setError(e instanceof StalePageError ? { message: e.message, stale: true } : { message: `Couldn't create the PDF: ${e}`, stale: false })
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
      <p>
        Start with the letters template. Everything else in this step is optional, and you can come back for it later.
      </p>

      <fieldset className="paper-choice">
        <legend>Paper</legend>
        {(Object.keys(PAGE_SIZES) as PageSizeId[]).map((id) => (
          <label key={id} className={size === id ? 'choice selected' : 'choice'}>
            <input type="radio" name="paper" value={id} checked={size === id} onChange={() => setSize(id)} /> {PAGE_SIZES[id].label}
          </label>
        ))}
      </fieldset>

      {error && (
        <p role="alert" className="bad">
          {error.message}{' '}
          {error.stale && (
            <button className="secondary small" onClick={() => window.location.reload()}>
              Reload page
            </button>
          )}
        </p>
      )}

      <div className="template-cards">
        <article className="card primary">
          <h3>Letters, numbers and punctuation</h3>
          <p className="note">
            {TEMPLATE_PAGES.length} pages, {CHARSET.length} characters. This is the one you need.
          </p>
          <label>
            Style{' '}
            <select value={style} onChange={(e) => setStyle(e.target.value as StyleId)}>
              {STYLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id === 'regular' ? 'Regular (start here)' : `${s.label} (optional)`}
                </option>
              ))}
            </select>
          </label>
          {style !== 'regular' && (
            <p className="note">
              Write this set in your {styleInfo(style).label.toLowerCase()} style. You can also skip it: the app can
              generate {styleInfo(style).label} from your Regular letters (step 4).
            </p>
          )}
          <div className="row">
            <button onClick={() => download([{ style }], setName)} disabled={busy}>
              Download PDF
            </button>
            <button className="secondary" onClick={() => preview([{ style }])} disabled={busy}>
              Preview
            </button>
          </div>
        </article>

        <article className="card">
          <h3>Redo sheet</h3>
          <p className="note">Rewrite a few characters without redoing the whole page. Mark them in step 3, or type them here.</p>
          {marked.length > 0 && (
            <p data-testid="redo-marked">
              Marked:{' '}
              {marked.map((g) => (
                <span key={g.style} className="redo-group">
                  {g.style !== 'regular' && <b>{styleInfo(g.style).label}: </b>}
                  <span className="redo-chars">{g.chars.join(' ')}</span>
                </span>
              ))}
              <button className="link" onClick={onClearRedo}>
                Clear
              </button>
            </p>
          )}
          <div className="row">
            <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. AgQ&" aria-label="Characters to redo" size={10} />
            <select value={extraStyle} onChange={(e) => setExtraStyle(e.target.value as StyleId)} aria-label="Style for typed characters">
              {STYLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          {unknown.length > 0 && <p className="warn">Not on the template: {unknown.join(' ')}</p>}
          <div className="row">
            <button onClick={() => download(redoSheets, 'handwriting-redo-sheet')} disabled={busy || redoSheets.length === 0}>
              Download redo sheet
            </button>
          </div>
        </article>

        <article className="card">
          <h3>Ligatures and alternate forms</h3>
          <p className="note">
            Joined letters like <i>th</i>, <i>oo</i> or <i>ing</i>, and letters that change shape next to others (an{' '}
            <i>e</i> after <i>r</i>).
          </p>
          <div className="row">
            <button className="secondary" onClick={() => download([{ ligatureSheet: COMMON_SHEET }], 'handwriting-ligatures-common')} disabled={busy}>
              Common ligatures
            </button>
          </div>
          <div className="row">
            <select value={blankSheet} onChange={(e) => setBlankSheet(Number(e.target.value))} aria-label="Blank ligature sheet number">
              {Array.from({ length: BLANK_SHEETS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Blank sheet {n}
                  {ligatureSheetsUploaded.has(n) ? ' (uploaded)' : ''}
                </option>
              ))}
            </select>
            <button className="secondary" onClick={() => download([{ ligatureSheet: blankSheet }], `handwriting-ligatures-blank-${blankSheet}`)} disabled={busy}>
              Download
            </button>
          </div>
          <details className="note">
            <summary>How blank boxes work</summary>
            After uploading, type what each box holds in step 3: <code>th</code> for a ligature, or <code>r[e]</code> for an
            “e” used after “r” (<code>[o]n</code>: an “o” before “n”). Each blank sheet has its own number, so sheets never
            overwrite each other. In Word, turn these on under Font → Advanced: <b>Ligatures</b> and{' '}
            <b>Use Contextual Alternates</b>.
          </details>
        </article>
      </div>

      <h3 className="tips-head">Filling it in</h3>
      <ul className="instructions">
        <li>
          Print <b>in color at 100% / Actual size</b>. The blue lines are guides the scanner ignores; gray lines just
          organize the page.
        </li>
        <li>
          Use a <b>black felt-tip pen</b>, and sit each character on the <b>solid blue baseline</b>.
        </li>
        <li>
          Scan at <b>300 DPI</b>, or photograph each page <b>flat, in even light</b>, with all four black corner squares in
          the picture.
        </li>
      </ul>
    </section>
  )
}
