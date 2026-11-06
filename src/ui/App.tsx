import { useMemo, useState } from 'react'
import { assembleGlyphs } from '../core/project'
import type { PageScan } from '../core/scan/processPage'
import { TEMPLATE_PAGES } from '../core/template/charset'
import { TEMPLATE_VERSION } from '../core/template/layout'
import { PreviewStep } from './PreviewStep'
import { ReviewStep } from './ReviewStep'
import { ScanFailure, scanFile } from './scanClient'
import { TemplateStep } from './TemplateStep'
import { UploadStep, type Upload } from './UploadStep'

/** Below this the page-ID reading is too doubtful to trust without asking. */
const MIN_ID_CONFIDENCE = 0.25

let nextKey = 1

/** Mark older uploads of the same page as replaced. */
function supersede(uploads: Upload[]): Upload[] {
  const latest = new Map<number, number>()
  for (const u of uploads) if (u.status === 'done' && u.pageIndex !== null) latest.set(u.pageIndex, u.key)
  return uploads.map((u) => ({ ...u, superseded: u.status === 'done' && u.pageIndex !== null && latest.get(u.pageIndex) !== u.key }))
}

export function App() {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [scans, setScans] = useState<Map<number, PageScan>>(new Map())

  const update = (key: number, patch: Partial<Upload>) =>
    setUploads((list) => supersede(list.map((u) => (u.key === key ? { ...u, ...patch } : u))))

  const pages = useMemo(() => {
    const m = new Map<number, PageScan>()
    for (const u of uploads) {
      if (u.status === 'done' && !u.superseded && u.pageIndex !== null && scans.has(u.key)) m.set(u.pageIndex, scans.get(u.key)!)
    }
    return m
  }, [uploads, scans])
  const glyphs = useMemo(() => assembleGlyphs(pages), [pages])

  function onFiles(files: File[]) {
    for (const file of files) {
      const key = nextKey++
      setUploads((list) => [...list, { key, fileName: file.name, status: 'processing', pageIndex: null, needsPagePick: false, superseded: false }])
      scanFile(file, (stage) => update(key, { stage }))
        .then((scan) => {
          setScans((m) => new Map(m).set(key, scan))
          const id = scan.pageId
          const trusted =
            id !== null && id.version === TEMPLATE_VERSION && id.pageIndex < TEMPLATE_PAGES.length && scan.idConfidence >= MIN_ID_CONFIDENCE
          update(key, { status: 'done', pageIndex: trusted ? id.pageIndex : null, needsPagePick: !trusted })
        })
        .catch((err: unknown) => {
          const f = err instanceof ScanFailure ? err : new ScanFailure(String(err), [])
          update(key, { status: 'error', error: f.message, tips: f.tips })
        })
    }
  }

  return (
    <main>
      <h1>Handwriting to Font</h1>
      <p>Turn your handwriting into a font you can install and use in Word.</p>
      <p className="note">Everything runs in your browser. Your handwriting never leaves your computer.</p>
      <TemplateStep />
      <UploadStep uploads={uploads} onFiles={onFiles} onPickPage={(key, pageIndex) => update(key, { pageIndex })} />
      <ReviewStep glyphs={glyphs} />
      <PreviewStep glyphs={glyphs} />
    </main>
  )
}
