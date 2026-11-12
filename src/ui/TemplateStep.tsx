import { useEffect, useRef, useState } from 'react'
import { CHARSET, TEMPLATE_PAGES } from '../core/template/charset'
import type { TemplateSheet } from '../core/template/generatePdf'
import { PAGE_SIZES, TEMPLATE_VERSION, type PageSizeId } from '../core/template/layout'
import type { LigatureGlyph } from '../core/project'
import { BLANK_SHEETS, COMMON_SHEET, ligatureSheetId, ligatureSheetName } from '../core/template/ligatures'
import { STYLES, styleInfo, type StyleId } from '../core/template/styles'
import { makeZip } from '../core/zip'
import { downloadBlob } from './fontFace'
import { loadOnDemand, StalePageError } from './lazy'

const KNOWN = new Set(CHARSET.map((c) => c.char))
/** Letters pages plus the common-ligatures sheet. */
const BASIC_PAGES = TEMPLATE_PAGES.length + 1

type DownloadFormat = 'single' | 'perPage'
const FORMAT_KEY = 'hw-template-download-format'

function loadFormat(): DownloadFormat {
  try {
    return localStorage.getItem(FORMAT_KEY) === 'perPage' ? 'perPage' : 'single'
  } catch {
    return 'single'
  }
}

function saveFormat(f: DownloadFormat) {
  try {
    localStorage.setItem(FORMAT_KEY, f)
  } catch {
    // Private windows may block storage; the choice just won't be remembered.
  }
}

interface Props {
  /** Characters marked for redo, as "style:char". */
  redo: Set<string>
  onClearRedo: () => void
  /** Ligature sheets already uploaded, by sheet id (style × 8 + n). */
  ligatureSheetsUploaded: Set<number>
  /** Uploaded ligature boxes, to name marked boxes by their text. */
  ligatures: LigatureGlyph[]
}

/** Marked ligature boxes ("style:lig:sheet:box"), grouped by sheet id. */
function ligatureRedo(redo: Set<string>): { sheet: number; boxes: number[] }[] {
  const bySheet = new Map<number, number[]>()
  for (const k of redo) {
    const m = /^[A-Za-z]+:lig:(\d+):(\d+)$/.exec(k)
    if (!m) continue
    const list = bySheet.get(Number(m[1])) ?? []
    list.push(Number(m[2]))
    bySheet.set(Number(m[1]), list)
  }
  return [...bySheet].sort(([a], [b]) => a - b).map(([sheet, boxes]) => ({ sheet, boxes: boxes.sort((a, b) => a - b) }))
}

/** Marked characters grouped by style, in charset order. */
function redoByStyle(redo: Set<string>): { style: StyleId; chars: string[] }[] {
  return STYLES.map((s) => ({ style: s.id, chars: CHARSET.map((c) => c.char).filter((ch) => redo.has(`${s.id}:${ch}`)) })).filter(
    (g) => g.chars.length > 0,
  )
}

/** The gear menu next to the main download: one PDF, or a PDF per page in a .zip. */
function DownloadOptions({ format, onChange }: { format: DownloadFormat; onChange: (f: DownloadFormat) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="download-options" ref={ref}>
      <button
        className="secondary gear"
        aria-label="Download options"
        aria-expanded={open}
        aria-controls="download-options-menu"
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.3 4.3c.4-1.8 3-1.8 3.4 0a1.7 1.7 0 0 0 2.6 1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 0 0 1 2.6c1.8.4 1.8 3 0 3.4a1.7 1.7 0 0 0-1 2.6c.9 1.5-.8 3.3-2.4 2.4a1.7 1.7 0 0 0-2.6 1c-.4 1.8-3 1.8-3.4 0a1.7 1.7 0 0 0-2.6-1c-1.5.9-3.3-.8-2.4-2.4a1.7 1.7 0 0 0-1-2.6c-1.8-.4-1.8-3 0-3.4a1.7 1.7 0 0 0 1-2.6c-.9-1.5.8-3.3 2.4-2.4a1.7 1.7 0 0 0 2.6-1zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0"
          />
        </svg>
      </button>
      {open && (
        <fieldset className="download-menu" id="download-options-menu">
          <legend>Download as</legend>
          <label>
            <input type="radio" name="download-format" checked={format === 'single'} onChange={() => onChange('single')} />
            <span>
              One PDF
              <span className="note">All pages in a single file</span>
            </span>
          </label>
          <label>
            <input type="radio" name="download-format" checked={format === 'perPage'} onChange={() => onChange('perPage')} />
            <span>
              A PDF per page
              <span className="note">Separate files, in one .zip</span>
            </span>
          </label>
          <p className="note menu-foot">Applies to every download in this step.</p>
        </fieldset>
      )}
    </div>
  )
}

export function TemplateStep({ redo, onClearRedo, ligatureSheetsUploaded, ligatures }: Props) {
  const [size, setSize] = useState<PageSizeId>('letter')
  const [style, setStyle] = useState<StyleId>('regular')
  const [format, setFormat] = useState<DownloadFormat>(loadFormat)
  const firstFreeBlank = (s: StyleId) =>
    Array.from({ length: BLANK_SHEETS }, (_, i) => i + 1).find((n) => !ligatureSheetsUploaded.has(ligatureSheetId(s, n))) ?? 1
  const [blankSheet, setBlankSheet] = useState(() => firstFreeBlank('regular'))
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; stale: boolean } | null>(null)

  const marked = redoByStyle(redo)
  const markedLigatures = ligatureRedo(redo)
  const hasMarks = marked.length > 0 || markedLigatures.length > 0
  const [moreOpen, setMoreOpen] = useState(hasMarks)
  // Open "More sheets" when something gets marked for redo in step 3.
  useEffect(() => {
    if (hasMarks) setMoreOpen(true)
  }, [hasMarks])

  function changeFormat(f: DownloadFormat) {
    setFormat(f)
    saveFormat(f)
  }

  function changeStyle(s: StyleId) {
    setStyle(s)
    setBlankSheet(firstFreeBlank(s))
  }

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
    if (!pdf) return
    const base = `${name}-v${TEMPLATE_VERSION}-${size}`
    if (format === 'single') {
      downloadBlob(pdf.slice().buffer, `${base}.pdf`, 'application/pdf')
      return
    }
    try {
      const { splitPdfPages } = await loadOnDemand(() => import('../core/template/generatePdf'))
      const pages = await splitPdfPages(pdf)
      const width = String(pages.length).length
      const zip = makeZip(pages.map((data, i) => ({ name: `${base}-page-${String(i + 1).padStart(width, '0')}.pdf`, data })))
      downloadBlob(zip.slice().buffer, `${base}.zip`, 'application/zip')
    } catch (e) {
      setError(e instanceof StalePageError ? { message: e.message, stale: true } : { message: `Couldn't split the PDF: ${e}`, stale: false })
    }
  }

  async function preview(sheets: TemplateSheet[]) {
    const pdf = await makePdf(sheets)
    if (!pdf) return
    const url = URL.createObjectURL(new Blob([pdf.slice().buffer], { type: 'application/pdf' }))
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const boxName = (sheet: number, box: number) => {
    const text = ligatures.find((g) => g.sheet === sheet && g.box === box)?.text.trim()
    return text ? `${box + 1} (${text})` : String(box + 1)
  }
  const typed = [...new Set([...extra].filter((ch) => KNOWN.has(ch)))]
  const unknown = [...new Set([...extra].filter((ch) => ch.trim() && !KNOWN.has(ch)))]
  const redoSheets: TemplateSheet[] = [...marked.map((g) => ({ style: g.style, only: g.chars }))]
  if (typed.length) {
    const existing = redoSheets.find((s) => s.style === style)
    if (existing) existing.only = [...new Set([...existing.only!, ...typed])]
    else redoSheets.push({ style, only: typed })
  }
  redoSheets.push(...markedLigatures.map((g) => ({ ligatureSheet: g.sheet, boxes: g.boxes })))

  const suffix = style === 'regular' ? '' : `-${style}`
  const basicSheets: TemplateSheet[] = [{ style }, { ligatureSheet: ligatureSheetId(style, COMMON_SHEET) }]
  const label = styleInfo(style).label

  return (
    <section aria-labelledby="step-template">
      <h2 id="step-template">1. Print the template</h2>

      <div className="template-settings">
        <fieldset className="paper-choice">
          <legend>Paper</legend>
          <div className="segmented">
            {(Object.keys(PAGE_SIZES) as PageSizeId[]).map((id) => (
              <label key={id} className={size === id ? 'choice selected' : 'choice'}>
                <input type="radio" name="paper" value={id} checked={size === id} onChange={() => setSize(id)} /> {PAGE_SIZES[id].label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="style-choice">
          <span className="setting-label">Style</span>
          <select value={style} onChange={(e) => changeStyle(e.target.value as StyleId)}>
            {STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {style !== 'regular' && (
        <p className="note style-note">
          Write every sheet in your {label.toLowerCase()} style. This is optional: if you skip it, step 4 can generate{' '}
          {label} from your Regular letters and ligatures.
        </p>
      )}

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

      <article className="card primary basic-card">
        <div className="basic-head">
          <div>
            <h3>{style === 'regular' ? 'Basic template' : `Basic template, ${label}`}</h3>
            <p className="note">
              {BASIC_PAGES} pages: {CHARSET.length} letters, numbers and punctuation, plus common ligatures (<i>th</i>,{' '}
              <i>oo</i>, <i>ing</i>…). Start here.
            </p>
          </div>
          <div className="row basic-actions">
            <button onClick={() => download(basicSheets, `handwriting-template${suffix}`)} disabled={busy}>
              {format === 'single' ? 'Download PDF' : `Download ${BASIC_PAGES} PDFs (.zip)`}
            </button>
            <button className="secondary" onClick={() => preview(basicSheets)} disabled={busy}>
              Preview
            </button>
            <DownloadOptions format={format} onChange={changeFormat} />
          </div>
        </div>
        <p className="tips">
          Print at <b>100%</b>, in color if you can · Use a <b>black felt-tip pen</b>, on the solid blue line · Scan at{' '}
          <b>300 DPI</b>, or photograph flat with all four corner squares
        </p>
        <details className="note">
          <summary>More printing tips</summary>
          The blue lines are guides the scanner ignores; gray lines just organize the page. Black-and-white printing works
          too, but color reads most reliably. Photograph each page flat, in even light. Leave any ligature you don’t want
          blank.
        </details>
      </article>

      <details className="more-sheets" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
        <summary>
          <b>More sheets</b> <span className="note">optional, any time later</span>
        </summary>

        <div className="sheet-row">
          <div>
            <h3>Redo sheet</h3>
            <p className="note">Only the boxes you pick. Mark them in step 3, or type them here.</p>
          </div>
          <div>
            {hasMarks && (
              <p data-testid="redo-marked" className="redo-marked">
                Marked:{' '}
                {marked.map((g) => (
                  <span key={g.style} className="redo-group">
                    {g.style !== 'regular' && <b>{styleInfo(g.style).label}: </b>}
                    <span className="redo-chars">{g.chars.join(' ')}</span>
                  </span>
                ))}
                {markedLigatures.map((g) => (
                  <span key={`lig${g.sheet}`} className="redo-group" data-testid="redo-marked-ligatures">
                    <b>{ligatureSheetName(g.sheet)}: </b>
                    box {g.boxes.map((b) => boxName(g.sheet, b)).join(', ')}
                  </span>
                ))}
                <button className="link" onClick={onClearRedo}>
                  Clear
                </button>
              </p>
            )}
            <div className="row">
              <input
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                placeholder="AgQ&"
                aria-label={`Characters to redo (${label})`}
                size={10}
              />
              <button onClick={() => download(redoSheets, 'handwriting-redo-sheet')} disabled={busy || redoSheets.length === 0}>
                Download redo sheet
              </button>
            </div>
            {unknown.length > 0 && <p className="warn">Not on the template: {unknown.join(' ')}</p>}
          </div>
        </div>

        <div className="sheet-row">
          <div>
            <h3>Blank ligature sheets</h3>
            <p className="note">
              Your own joined letters, or a letter that changes shape next to another (an <i>e</i> after <i>r</i>).
            </p>
          </div>
          <div>
            <div className="row">
              <select value={blankSheet} onChange={(e) => setBlankSheet(Number(e.target.value))} aria-label="Blank ligature sheet number">
                {Array.from({ length: BLANK_SHEETS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Blank sheet {n}
                    {ligatureSheetsUploaded.has(ligatureSheetId(style, n)) ? ' (uploaded)' : ''}
                  </option>
                ))}
              </select>
              <button
                className="secondary"
                onClick={() => download([{ ligatureSheet: ligatureSheetId(style, blankSheet) }], `handwriting-ligatures${suffix}-blank-${blankSheet}`)}
                disabled={busy}
              >
                Download
              </button>
            </div>
            <details className="note">
              <summary>How blank boxes work</summary>
              After uploading, type what each box holds in step 3: <code>th</code> for a ligature, or <code>r[e]</code> for
              an “e” used after “r” (<code>[o]n</code>: an “o” before “n”). Each blank sheet has its own number, so sheets
              never overwrite each other. In Word, turn these on under Font → Advanced: <b>Ligatures</b> and{' '}
              <b>Use Contextual Alternates</b>.
            </details>
          </div>
        </div>
      </details>
    </section>
  )
}
