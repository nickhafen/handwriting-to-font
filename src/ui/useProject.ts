// Upload, scan and ink-adjustment state for the app. Re-traces only the cells a
// settings change affects, and ignores results that a newer change has overtaken.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assembleGlyphs, type ReviewGlyph } from '../core/project'
import { DEFAULT_ADJUST, sameAdjust, type InkAdjust } from '../core/scan/adjust'
import type { CellResult } from '../core/scan/cells'
import type { PageScan } from '../core/scan/processPage'
import { TEMPLATE_PAGES } from '../core/template/charset'
import { CELLS_PER_PAGE, TEMPLATE_VERSION } from '../core/template/layout'
import { retraceCells, ScanFailure, scanFile } from './scanClient'
import type { Upload } from './UploadStep'

/** Below this the page-ID reading is too doubtful to trust without asking. */
const MIN_ID_CONFIDENCE = 0.25
const GLOBAL_DEBOUNCE_MS = 400
const LETTER_DEBOUNCE_MS = 250

let nextKey = 1

/** Mark older uploads of the same page as replaced. */
function supersede(uploads: Upload[]): Upload[] {
  const latest = new Map<number, number>()
  for (const u of uploads) if (u.status === 'done' && u.pageIndex !== null) latest.set(u.pageIndex, u.key)
  return uploads.map((u) => ({ ...u, superseded: u.status === 'done' && u.pageIndex !== null && latest.get(u.pageIndex) !== u.key }))
}

/** The character in a grid cell of a page, if any. */
const charAt = (pageIndex: number | null, cellIndex: number) =>
  pageIndex === null ? undefined : TEMPLATE_PAGES[pageIndex]?.cells[cellIndex]?.char

const ALL_CELLS = Array.from({ length: CELLS_PER_PAGE }, (_, i) => i)

export interface ProjectState {
  uploads: Upload[]
  glyphs: ReviewGlyph[]
  adjust: InkAdjust
  overrides: Record<string, InkAdjust>
  /** Number of re-trace jobs still running. */
  busy: number
  addFiles(files: File[]): void
  pickPage(key: number, pageIndex: number): void
  setAdjust(a: InkAdjust): void
  /** Set (or with null, clear) the ink settings for one character. */
  setOverride(char: string, a: InkAdjust | null): void
}

export function useProject(): ProjectState {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [scans, setScans] = useState<Map<number, PageScan>>(new Map())
  const [adjust, setAdjustState] = useState<InkAdjust>(DEFAULT_ADJUST)
  const [overrides, setOverrides] = useState<Record<string, InkAdjust>>({})
  const [busy, setBusy] = useState(0)

  // Latest values for async callbacks.
  const ref = useRef({ uploads, scans, adjust, overrides })
  ref.current = { uploads, scans, adjust, overrides }
  /** Global settings each upload's cells were last processed with. */
  const appliedGlobal = useRef(new Map<number, InkAdjust>())
  const letterTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const updateUpload = useCallback(
    (key: number, patch: Partial<Upload>) => setUploads((list) => supersede(list.map((u) => (u.key === key ? { ...u, ...patch } : u)))),
    [],
  )

  /** Settings that should apply to a cell right now. */
  const wanted = (pageIndex: number | null, cellIndex: number): InkAdjust => {
    const ch = charAt(pageIndex, cellIndex)
    return (ch && ref.current.overrides[ch]) || ref.current.adjust
  }

  /** Re-process some cells of one upload with `adj`; keep only results that are still wanted. */
  const retrace = useCallback(async (key: number, cellIndices: number[], adj: InkAdjust) => {
    const scan = ref.current.scans.get(key)
    if (!scan || cellIndices.length === 0) return
    setBusy((n) => n + 1)
    try {
      const crops = cellIndices.map((i) => scan.cells[i]).map(({ index, width, height, gray }) => ({ index, width, height, gray }))
      const results = await retraceCells(crops, adj)
      const pageIndex = ref.current.uploads.find((u) => u.key === key)?.pageIndex ?? null
      setScans((m) => {
        const s = m.get(key)
        if (!s) return m
        const cells: CellResult[] = s.cells.slice()
        for (const r of results) if (sameAdjust(wanted(pageIndex, r.index), adj)) cells[r.index] = r
        return new Map(m).set(key, { ...s, cells })
      })
    } finally {
      setBusy((n) => n - 1)
    }
  }, [])

  /** Bring every overridden character on an upload's page up to date. */
  const applyOverrides = useCallback(
    (key: number, pageIndex: number) => {
      for (const [ch, adj] of Object.entries(ref.current.overrides)) {
        const cellIndex = TEMPLATE_PAGES[pageIndex].cells.findIndex((c) => c?.char === ch)
        if (cellIndex >= 0) void retrace(key, [cellIndex], adj)
      }
    },
    [retrace],
  )

  const addFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const key = nextKey++
        const adj = ref.current.adjust
        setUploads((list) => [...list, { key, fileName: file.name, status: 'processing', pageIndex: null, needsPagePick: false, superseded: false }])
        scanFile(file, adj, (stage) => updateUpload(key, { stage }))
          .then((scan) => {
            appliedGlobal.current.set(key, adj)
            setScans((m) => new Map(m).set(key, scan))
            const id = scan.pageId
            const trusted =
              id !== null && id.version === TEMPLATE_VERSION && id.pageIndex < TEMPLATE_PAGES.length && scan.idConfidence >= MIN_ID_CONFIDENCE
            updateUpload(key, { status: 'done', pageIndex: trusted ? id.pageIndex : null, needsPagePick: !trusted })
            // setScans/updateUpload land before the next tick; then catch up on any settings changed meanwhile.
            setTimeout(() => {
              if (!sameAdjust(adj, ref.current.adjust)) {
                appliedGlobal.current.set(key, ref.current.adjust)
                void retrace(key, ALL_CELLS, ref.current.adjust)
              }
              if (trusted) applyOverrides(key, id.pageIndex)
            })
          })
          .catch((err: unknown) => {
            const f = err instanceof ScanFailure ? err : new ScanFailure(String(err), [])
            updateUpload(key, { status: 'error', error: f.message, tips: f.tips })
          })
      }
    },
    [applyOverrides, retrace, updateUpload],
  )

  const pickPage = useCallback(
    (key: number, pageIndex: number) => {
      updateUpload(key, { pageIndex })
      setTimeout(() => applyOverrides(key, pageIndex))
    },
    [applyOverrides, updateUpload],
  )

  // Global settings changed: re-trace every non-overridden cell of each active upload (debounced).
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const u of ref.current.uploads) {
        if (u.status !== 'done' || u.superseded) continue
        const last = appliedGlobal.current.get(u.key)
        if (last && sameAdjust(last, adjust)) continue
        appliedGlobal.current.set(u.key, adjust)
        const cells = ALL_CELLS.filter((i) => {
          const ch = charAt(u.pageIndex, i)
          return u.pageIndex === null || (ch !== undefined && !ref.current.overrides[ch])
        })
        void retrace(u.key, cells, adjust)
      }
    }, GLOBAL_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [adjust, retrace])

  const setOverride = useCallback(
    (char: string, a: InkAdjust | null) => {
      setOverrides((o) => {
        const next = { ...o }
        if (a) next[char] = a
        else delete next[char]
        return next
      })
      const timers = letterTimers.current
      clearTimeout(timers.get(char))
      timers.set(
        char,
        setTimeout(() => {
          timers.delete(char)
          const adj = ref.current.overrides[char] ?? ref.current.adjust
          for (const u of ref.current.uploads) {
            if (u.status !== 'done' || u.superseded || u.pageIndex === null) continue
            const cellIndex = TEMPLATE_PAGES[u.pageIndex].cells.findIndex((c) => c?.char === char)
            if (cellIndex >= 0) void retrace(u.key, [cellIndex], adj)
          }
        }, LETTER_DEBOUNCE_MS),
      )
    },
    [retrace],
  )

  const pages = useMemo(() => {
    const m = new Map<number, PageScan>()
    for (const u of uploads) {
      if (u.status === 'done' && !u.superseded && u.pageIndex !== null && scans.has(u.key)) m.set(u.pageIndex, scans.get(u.key)!)
    }
    return m
  }, [uploads, scans])
  const glyphs = useMemo(() => assembleGlyphs(pages), [pages])

  return { uploads, glyphs, adjust, overrides, busy, addFiles, pickPage, setAdjust: setAdjustState, setOverride }
}
