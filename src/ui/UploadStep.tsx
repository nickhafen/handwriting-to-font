import { useRef, useState } from 'react'
import type { ScanStage } from '../core/scan/processPage'
import { TEMPLATE_PAGES } from '../core/template/charset'
import { slotLabel, STYLES, type Slot } from '../core/template/styles'
import type { Upload } from './useProject'

const STAGE_TEXT: Record<ScanStage, string> = {
  loading: 'Opening image…',
  markers: 'Finding the corner squares…',
  warping: 'Straightening the page…',
  'page-id': 'Reading the page number…',
  cells: 'Cutting out the letters…',
  tracing: 'Tracing outlines…',
}

const ALL_SLOTS: Slot[] = STYLES.flatMap((s) => TEMPLATE_PAGES.map((p) => ({ style: s.id, page: p.index })))
const slotValue = (s: Slot) => `${s.style}/${s.page}`

interface Props {
  uploads: Upload[]
  onFiles: (files: File[]) => void
  onPickSlot: (key: number, slot: Slot) => void
  onRemove: (key: number) => void
  restored: { files: number; savedAt: number } | null
  onStartOver: () => void
}

/** Dev server only: load the images in ./samples whose names contain "color" (or all of them if none do). */
async function loadSamples(): Promise<File[]> {
  const base = `${import.meta.env.BASE_URL}__samples/`
  const names: string[] = await (await fetch(base)).json()
  const color = names.filter((n) => /color/i.test(n))
  const chosen = color.length ? color : names
  return Promise.all(
    chosen.map(async (n) => {
      const blob = await (await fetch(base + encodeURIComponent(n))).blob()
      return new File([blob], n, { type: blob.type })
    }),
  )
}

export function UploadStep({ uploads, onFiles, onPickSlot, onRemove, restored, onStartOver }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [sampleError, setSampleError] = useState<string | null>(null)

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
        <div className="row centered">
          <button onClick={() => input.current?.click()}>Choose files…</button>
          {import.meta.env.DEV && (
            <button
              className="secondary"
              data-testid="load-samples"
              onClick={() => {
                setSampleError(null)
                loadSamples()
                  .then((files) => (files.length ? onFiles(files) : setSampleError('No images in the samples folder.')))
                  .catch((e) => setSampleError(`Couldn't load samples: ${e}`))
              }}
            >
              Load samples (dev)
            </button>
          )}
        </div>
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
        {sampleError && <p className="bad">{sampleError}</p>}
      </div>
      <p className="note autosave-note" data-testid="autosave-note">
        {restored
          ? `Restored your project from ${new Date(restored.savedAt).toLocaleString()} (${restored.files} image${restored.files === 1 ? '' : 's'}). `
          : ''}
        Your project is saved automatically in this browser (never uploaded anywhere).{' '}
        {(uploads.length > 0 || restored) && (
          <button
            className="link"
            onClick={() => {
              if (window.confirm('Delete your saved project (scans and settings) and start over?')) onStartOver()
            }}
          >
            Start over
          </button>
        )}
      </p>
      <p className="note">
        Uploading a page again only replaces the characters written on the new copy; blank boxes keep the earlier
        version. That's how redo sheets work.
      </p>

      {uploads.length > 0 && (
        <ul className="uploads" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.key} data-testid="upload-row" data-status={u.status}>
              <b>{u.fileName}</b>
              {': '}
              {u.status === 'processing' && <span>{u.stage ? STAGE_TEXT[u.stage] : 'Waiting…'}</span>}
              {u.status === 'done' && u.slot && !u.needsPagePick && (
                <span className={u.used ? 'good' : 'muted'}>
                  {slotLabel(u.slot)} detected.{' '}
                  {u.used ? `Supplies ${u.used} character${u.used === 1 ? '' : 's'}.` : 'Every character has been replaced by a newer upload.'}
                </span>
              )}
              {u.status === 'done' && u.needsPagePick && (
                <label>
                  <span className="warn">Couldn't read the page number. Which page is this? </span>
                  <select
                    value={u.slot ? slotValue(u.slot) : ''}
                    onChange={(e) => {
                      const slot = ALL_SLOTS.find((s) => slotValue(s) === e.target.value)
                      if (slot) onPickSlot(u.key, slot)
                    }}
                    aria-label={`Page for ${u.fileName}`}
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {ALL_SLOTS.map((s) => (
                      <option key={slotValue(s)} value={slotValue(s)}>
                        {slotLabel(s)}
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
              {u.status !== 'processing' && (
                <button className="link" onClick={() => onRemove(u.key)} aria-label={`Remove ${u.fileName}`}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
