import { useRef, useState } from 'react'
import type { ScanStage } from '../core/scan/processPage'
import { TEMPLATE_PAGES } from '../core/template/charset'
import { TEMPLATE_VERSION } from '../core/template/layout'

export interface Upload {
  key: number
  fileName: string
  status: 'processing' | 'done' | 'error'
  stage?: ScanStage
  error?: string
  tips?: string[]
  /** Page index read from the ID strip, or chosen by the user when the strip can't be read. */
  pageIndex: number | null
  /** The ID strip was unreadable or doubtful; ask the user. */
  needsPagePick: boolean
  /** Replaced by a later upload of the same page. */
  superseded: boolean
}

const STAGE_TEXT: Record<ScanStage, string> = {
  loading: 'Opening image…',
  markers: 'Finding the corner squares…',
  warping: 'Straightening the page…',
  'page-id': 'Reading the page number…',
  cells: 'Cutting out the letters…',
}

export const PAGE_NAMES = ['Page 1 (letters)', 'Page 2 (numbers and punctuation)']

interface Props {
  uploads: Upload[]
  onFiles: (files: File[]) => void
  onPickPage: (key: number, pageIndex: number) => void
}

export function UploadStep({ uploads, onFiles, onPickPage }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const accept = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => /^image\/(png|jpeg)$/.test(f.type) || /\.(png|jpe?g)$/i.test(f.name))
    if (files.length) onFiles(files)
  }

  return (
    <section aria-labelledby="step-upload">
      <h2 id="step-upload">2. Upload your scans</h2>
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          accept(e.dataTransfer.files)
        }}
      >
        <p>Drag and drop your scans or photos here (JPG or PNG), one image per page.</p>
        <button onClick={() => input.current?.click()}>Choose files…</button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg"
          multiple
          hidden
          data-testid="upload-input"
          onChange={(e) => {
            accept(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      <p className="note">Uploading a page again replaces the earlier copy of that page.</p>

      {uploads.length > 0 && (
        <ul className="uploads" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.key} className={u.superseded ? 'superseded' : ''} data-testid="upload-row" data-status={u.status}>
              <b>{u.fileName}</b>
              {': '}
              {u.status === 'processing' && <span>{u.stage ? STAGE_TEXT[u.stage] : 'Waiting…'}</span>}
              {u.status === 'done' && u.superseded && <span>Replaced by a newer upload of this page.</span>}
              {u.status === 'done' && !u.superseded && !u.needsPagePick && u.pageIndex !== null && (
                <span className="good">{PAGE_NAMES[u.pageIndex] ?? `Page ${u.pageIndex + 1}`} detected</span>
              )}
              {u.status === 'done' && u.needsPagePick && (
                <label>
                  <span className="warn">Couldn't read the page number. Which page is this? </span>
                  <select
                    value={u.pageIndex ?? ''}
                    onChange={(e) => onPickPage(u.key, Number(e.target.value))}
                    aria-label={`Page for ${u.fileName}`}
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {TEMPLATE_PAGES.map((p) => (
                      <option key={p.index} value={p.index}>
                        {PAGE_NAMES[p.index]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {u.status === 'error' && (
                <div role="alert">
                  <span className="bad">{u.error}</span>
                  {u.tips && u.tips.length > 0 && (
                    <ul className="tips">
                      {u.tips.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="note">Template version {TEMPLATE_VERSION}.</p>
    </section>
  )
}
