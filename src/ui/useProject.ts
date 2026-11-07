// Upload, scan, ink-adjustment and style state for the app. Re-traces only the
// cells a settings change affects, and ignores results that a newer change has overtaken.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  assembleGlyphs,
  assembleLigatures,
  DEFAULT_FONT_SETTINGS,
  DEFAULT_GENERATE,
  effectiveGlyphs,
  glyphKey,
  isDefaultMetrics,
  ligatureKey,
  mergeUploads,
  type FontSettings,
  type GenerateSettings,
  type GlyphMetrics,
  type GlyphsByStyle,
  type LigatureGlyph,
  type LigatureSettings,
} from '../core/project'
import type { LigatureFeature } from '../core/font/gsub'
import { BLANK_SHEETS, ligatureSheetOf } from '../core/template/ligatures'
import { DEFAULT_ADJUST, sameAdjust, type InkAdjust } from '../core/scan/adjust'
import type { CellResult } from '../core/scan/cells'
import type { PageScan } from '../core/scan/processPage'
import { TEMPLATE_PAGES } from '../core/template/charset'
import { CELLS_PER_PAGE, TEMPLATE_VERSION } from '../core/template/layout'
import { slotOf, STYLE_IDS, type Slot, type StyleId } from '../core/template/styles'
import { clearProject, loadProject, saveProject, type SavedProject } from './persist'
import { retraceCells, ScanFailure, scanFile } from './scanClient'
import { DEFAULT_PREVIEW_SIZE, DEFAULT_PREVIEW_TEXT } from './sampleText'

/** Below this the page-ID reading is too doubtful to trust without asking. */
const MIN_ID_CONFIDENCE = 0.25
const GLOBAL_DEBOUNCE_MS = 400
const LETTER_DEBOUNCE_MS = 250
const BOLD_DEBOUNCE_MS = 500
const SAVE_DEBOUNCE_MS = 600

export interface Upload {
  key: number
  fileName: string
  status: 'processing' | 'done' | 'error'
  stage?: import('../core/scan/processPage').ScanStage
  error?: string
  tips?: string[]
  /** Style and page read from the ID strip, or chosen by the user when it can't be read. */
  slot: Slot | null
  /** The ID strip was unreadable or doubtful; ask the user. */
  needsPagePick: boolean
  /** Characters this upload currently supplies (later uploads of the same page can replace some). */
  used: number
  /** Set when this is a ligature sheet (0 = common, 1–7 = blank sheets). */
  ligatureSheet: number | null
}

let nextKey = 1

export const overrideKey = glyphKey

/** The character in a grid cell of a template page, if any. */
const charAt = (page: number, cellIndex: number) => TEMPLATE_PAGES[page]?.cells[cellIndex]?.char
const ALL_CELLS = Array.from({ length: CELLS_PER_PAGE }, (_, i) => i)
const charCells = (page: number) => ALL_CELLS.filter((i) => charAt(page, i) !== undefined)

export interface ProjectState {
  uploads: Upload[]
  /** Written glyphs per style (what was scanned). */
  written: GlyphsByStyle
  /** Glyphs that go into each style's font (written, or generated from Regular). */
  glyphs: GlyphsByStyle
  /** Styles that have at least one uploaded page. */
  uploadedStyles: Set<StyleId>
  adjust: InkAdjust
  overrides: Record<string, InkAdjust>
  generate: GenerateSettings
  /** Characters marked for a redo sheet, as overrideKey(style, char). */
  redo: Set<string>
  /** Ligature and contextual-alternate boxes from uploaded ligature sheets. */
  ligatures: LigatureGlyph[]
  ligatureSheetsUploaded: Set<number>
  setLigatureText(key: string, text: string): void
  setLigatureFeature(key: string, feature: LigatureFeature): void
  /** Per-character position and spacing, as glyphKey(style, char). */
  metrics: Record<string, GlyphMetrics>
  font: FontSettings
  previewText: string
  previewSize: number
  /** Set after loading a saved project: how many images were restored and when they were saved. */
  restored: { files: number; savedAt: number } | null
  /** Number of background re-trace jobs still running. */
  busy: number
  addFiles(files: File[]): void
  removeUpload(key: number): void
  pickSlot(key: number, slot: Slot): void
  setAdjust(a: InkAdjust): void
  /** Set (or with null, clear) the ink settings for one character of one style. */
  setOverride(style: StyleId, char: string, a: InkAdjust | null): void
  /** Make `a` the setting for every letter: sets the global settings and clears all overrides. */
  applyToAll(a: InkAdjust): void
  setGenerate(g: GenerateSettings): void
  toggleRedo(style: StyleId, char: string): void
  clearRedo(): void
  /** Set (or with null, clear) one character's position and spacing. */
  setMetrics(key: string, m: GlyphMetrics | null): void
  setFont(f: FontSettings): void
  setPreviewText(t: string): void
  setPreviewSize(n: number): void
  /** Delete the saved project and start fresh. */
  startOver(): Promise<void>
}

const emptyByStyle = (): GlyphsByStyle => ({
  regular: assembleGlyphs(new Map(), 'regular'),
  bold: assembleGlyphs(new Map(), 'bold'),
  italic: assembleGlyphs(new Map(), 'italic'),
  boldItalic: assembleGlyphs(new Map(), 'boldItalic'),
})

export function useProject(): ProjectState {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [scans, setScans] = useState<Map<number, PageScan>>(new Map())
  const [boldScans, setBoldScans] = useState<Map<number, PageScan>>(new Map())
  const [adjust, setAdjustState] = useState<InkAdjust>(DEFAULT_ADJUST)
  const [overrides, setOverrides] = useState<Record<string, InkAdjust>>({})
  const [generate, setGenerate] = useState<GenerateSettings>(DEFAULT_GENERATE)
  const [redo, setRedo] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(0)
  const [metrics, setMetricsState] = useState<Record<string, GlyphMetrics>>({})
  const [ligatureSettings, setLigatureSettings] = useState<LigatureSettings>({ texts: {}, features: {} })
  const [font, setFont] = useState<FontSettings>(DEFAULT_FONT_SETTINGS)
  const [previewText, setPreviewText] = useState(DEFAULT_PREVIEW_TEXT)
  const [previewSize, setPreviewSize] = useState(DEFAULT_PREVIEW_SIZE)
  const [restored, setRestored] = useState<{ files: number; savedAt: number } | null>(null)
  /** The original image for each upload, kept for autosave. */
  const files = useRef(new Map<number, File>())
  /** Restore runs once; saving waits until it has started the restored scans. */
  const restoreStarted = useRef(false)
  const loaded = useRef(false)

  // Latest values for async callbacks.
  const ref = useRef({ uploads, scans, adjust, overrides, generate })
  ref.current = { uploads, scans, adjust, overrides, generate }
  /** Global settings each upload's cells were last processed with. */
  const appliedGlobal = useRef(new Map<number, InkAdjust>())
  const letterTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const boldSignature = useRef('')

  const updateUpload = useCallback(
    (key: number, patch: Partial<Upload>) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u))),
    [],
  )

  /** Per-character settings key for a cell of an upload (ligature boxes count as Regular "characters"). */
  const keyFor = (u: Pick<Upload, 'slot' | 'ligatureSheet'> | undefined, cellIndex: number): string | null => {
    if (!u) return null
    if (u.ligatureSheet !== null) return overrideKey('regular', ligatureKey(u.ligatureSheet, cellIndex))
    const ch = u.slot ? charAt(u.slot.page, cellIndex) : undefined
    return u.slot && ch ? overrideKey(u.slot.style, ch) : null
  }

  /** Settings that should apply to a cell of an upload right now. */
  const wanted = (u: Pick<Upload, 'slot' | 'ligatureSheet'> | undefined, cellIndex: number): InkAdjust => {
    const k = keyFor(u, cellIndex)
    return (k && ref.current.overrides[k]) || ref.current.adjust
  }

  /** Re-process some cells of one upload with `adj`; keep only results that are still wanted. */
  const retrace = useCallback(async (key: number, cellIndices: number[], adj: InkAdjust) => {
    const scan = ref.current.scans.get(key)
    const indices = cellIndices.filter((i) => i < (scan?.cells.length ?? 0))
    if (!scan || indices.length === 0) return
    setBusy((n) => n + 1)
    try {
      const crops = indices.map((i) => scan.cells[i]).map(({ index, width, height, gray }) => ({ index, width, height, gray }))
      const results = await retraceCells(crops, adj)
      const upload = ref.current.uploads.find((u) => u.key === key)
      setScans((m) => {
        const s = m.get(key)
        if (!s) return m
        const cells: CellResult[] = s.cells.slice()
        for (const r of results) if (sameAdjust(wanted(upload, r.index), adj)) cells[r.index] = r
        return new Map(m).set(key, { ...s, cells })
      })
    } finally {
      setBusy((n) => n - 1)
    }
  }, [])

  /** Bring every overridden character on an upload's page up to date. */
  const applyOverrides = useCallback(
    (key: number, slot: Slot) => {
      for (const [k, adj] of Object.entries(ref.current.overrides)) {
        const [style, ch] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
        if (style !== slot.style) continue
        const cellIndex = TEMPLATE_PAGES[slot.page].cells.findIndex((c) => c?.char === ch)
        if (cellIndex >= 0) void retrace(key, [cellIndex], adj)
      }
    },
    [retrace],
  )

  /** Bring every adjusted box of a ligature sheet up to date. */
  const applyLigatureOverrides = (key: number, sheet: number) => {
    const prefix = overrideKey('regular', `lig:${sheet}:`)
    for (const [k, adj] of Object.entries(ref.current.overrides)) {
      if (k.startsWith(prefix)) void retrace(key, [Number(k.slice(prefix.length))], adj)
    }
  }

  /** A page arrived: clear redo marks for the characters it contains. */
  const clearRedoFor = (slot: Slot, scan: PageScan) =>
    setRedo((r) => {
      const next = new Set(r)
      for (const i of charCells(slot.page)) if (!scan.cells[i].empty) next.delete(overrideKey(slot.style, charAt(slot.page, i)!))
      return next.size === r.size ? r : next
    })

  const addFile = useCallback(
    (file: File, opts: { pickedSlot?: Slot | null; restoring?: boolean } = {}) => {
      {
        const key = nextKey++
        files.current.set(key, file)
        const adj = ref.current.adjust
        setUploads((list) => [...list, { key, fileName: file.name, status: 'processing', slot: null, needsPagePick: false, used: 0, ligatureSheet: null }])
        scanFile(file, adj, (stage) => updateUpload(key, { stage }))
          .then((scan) => {
            appliedGlobal.current.set(key, adj)
            setScans((m) => new Map(m).set(key, scan))
            const id = scan.pageId
            const detected = id && id.version === TEMPLATE_VERSION && scan.idConfidence >= MIN_ID_CONFIDENCE ? slotOf(id.pageIndex) : null
            const sheet = id && id.version === TEMPLATE_VERSION && scan.idConfidence >= MIN_ID_CONFIDENCE ? ligatureSheetOf(id.pageIndex) : null
            const slot = sheet !== null ? null : (detected ?? opts.pickedSlot ?? null)
            updateUpload(key, { status: 'done', slot, ligatureSheet: sheet, needsPagePick: sheet === null && !detected })
            // A restored project already has the right redo marks.
            if (slot && !opts.restoring) clearRedoFor(slot, scan)
            // State lands before the next tick; then catch up on any settings changed meanwhile.
            setTimeout(() => {
              if (!sameAdjust(adj, ref.current.adjust)) {
                appliedGlobal.current.set(key, ref.current.adjust)
                void retrace(key, ALL_CELLS, ref.current.adjust)
              }
              if (slot) applyOverrides(key, slot)
              if (sheet !== null) applyLigatureOverrides(key, sheet)
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

  const addFiles = useCallback((list: File[]) => list.forEach((f) => addFile(f)), [addFile])

  const removeUpload = useCallback((key: number) => {
    files.current.delete(key)
    setUploads((list) => list.filter((u) => u.key !== key))
    setScans((m) => {
      const next = new Map(m)
      next.delete(key)
      return next
    })
  }, [])

  const pickSlot = useCallback(
    (key: number, slot: Slot) => {
      updateUpload(key, { slot })
      setTimeout(() => applyOverrides(key, slot))
    },
    [applyOverrides, updateUpload],
  )

  // Global settings changed: re-trace every non-overridden cell of each upload (debounced).
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const u of ref.current.uploads) {
        if (u.status !== 'done') continue
        const last = appliedGlobal.current.get(u.key)
        if (last && sameAdjust(last, adjust)) continue
        appliedGlobal.current.set(u.key, adjust)
        const count = ref.current.scans.get(u.key)?.cells.length ?? 0
        const cells = Array.from({ length: count }, (_, i) => i).filter((i) => {
          if (!u.slot && u.ligatureSheet === null) return true
          const k = keyFor(u, i)
          return k !== null && !ref.current.overrides[k]
        })
        void retrace(u.key, cells, adjust)
      }
    }, GLOBAL_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [adjust, retrace])

  /** Re-trace one character on every upload of its style's page. */
  const retraceChar = useCallback(
    (style: StyleId, char: string) => {
      const adj = ref.current.overrides[overrideKey(style, char)] ?? ref.current.adjust
      const lig = /^lig:(\d+):(\d+)$/.exec(char)
      if (lig) {
        for (const u of ref.current.uploads) {
          if (u.status === 'done' && u.ligatureSheet === Number(lig[1])) void retrace(u.key, [Number(lig[2])], adj)
        }
        return
      }
      for (const u of ref.current.uploads) {
        if (u.status !== 'done' || !u.slot || u.slot.style !== style) continue
        const cellIndex = TEMPLATE_PAGES[u.slot.page].cells.findIndex((c) => c?.char === char)
        if (cellIndex >= 0) void retrace(u.key, [cellIndex], adj)
      }
    },
    [retrace],
  )

  const setOverride = useCallback(
    (style: StyleId, char: string, a: InkAdjust | null) => {
      const k = overrideKey(style, char)
      setOverrides((o) => {
        const next = { ...o }
        if (a) next[k] = a
        else delete next[k]
        return next
      })
      const timers = letterTimers.current
      clearTimeout(timers.get(k))
      timers.set(
        k,
        setTimeout(() => {
          timers.delete(k)
          retraceChar(style, char)
        }, LETTER_DEBOUNCE_MS),
      )
    },
    [retraceChar],
  )

  const applyToAll = useCallback((a: InkAdjust) => {
    setOverrides({})
    // A fresh object always re-runs the global pass, which now re-traces every letter.
    setAdjustState({ ...a })
    for (const u of ref.current.uploads) appliedGlobal.current.delete(u.key)
  }, [])

  const toggleRedo = useCallback((style: StyleId, char: string) => {
    setRedo((r) => {
      const next = new Set(r)
      const k = overrideKey(style, char)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }, [])

  // ------------------------------------------------------------ merging -----

  const merged = useMemo(() => {
    const byStyle = new Map<StyleId, Map<number, PageScan>>(STYLE_IDS.map((s) => [s, new Map()]))
    const used = new Map<number, number>()
    for (const style of STYLE_IDS) {
      for (let page = 0; page < TEMPLATE_PAGES.length; page++) {
        const list = uploads
          .filter((u) => u.status === 'done' && u.slot?.style === style && u.slot.page === page && scans.has(u.key))
          .map((u) => ({ key: u.key, scan: scans.get(u.key)! }))
        const m = mergeUploads(page, list)
        if (!m) continue
        byStyle.get(style)!.set(page, m.scan)
        for (const [k, n] of m.used) used.set(k, n)
      }
    }
    const ligatureSheets = new Map<number, PageScan>()
    for (let sheet = 0; sheet <= BLANK_SHEETS; sheet++) {
      const list = uploads
        .filter((u) => u.status === 'done' && u.ligatureSheet === sheet && scans.has(u.key))
        .map((u) => ({ key: u.key, scan: scans.get(u.key)! }))
      const m = mergeUploads(-1, list, () => true)
      if (!m) continue
      ligatureSheets.set(sheet, m.scan)
      for (const [k, n] of m.used) used.set(k, n)
    }
    return { byStyle, used, ligatureSheets }
  }, [uploads, scans])

  // Keep each upload's "characters used" count in sync with the merge.
  useEffect(() => {
    setUploads((list) => {
      let changed = false
      const next = list.map((u) => {
        const n = merged.used.get(u.key) ?? 0
        if (n === u.used) return u
        changed = true
        return { ...u, used: n }
      })
      return changed ? next : list
    })
  }, [merged])

  // ------------------------------------------------ Bold from Regular -------

  // Re-trace the Regular pages with thicker strokes whenever anything that feeds them changes (debounced).
  useEffect(() => {
    const regular = uploads.filter((u) => u.status === 'done' && u.slot?.style === 'regular' && scans.has(u.key))
    const regOverrides = Object.entries(overrides).filter(([k]) => k.startsWith('regular:'))
    const sig = JSON.stringify([generate.bold, generate.boldAmount, regular.map((u) => u.key), adjust, regOverrides])
    if (!generate.bold || regular.length === 0) {
      boldSignature.current = sig
      return
    }
    if (sig === boldSignature.current) return
    const timer = setTimeout(async () => {
      boldSignature.current = sig
      setBusy((n) => n + 1)
      try {
        for (const u of regular) {
          const scan = ref.current.scans.get(u.key)
          if (!scan || !u.slot) continue
          // Group cells by the settings they use, so each group is one worker request.
          const groups = new Map<string, { adj: InkAdjust; cells: number[] }>()
          for (const i of charCells(u.slot.page)) {
            const a = wanted(u, i)
            const g = groups.get(JSON.stringify(a)) ?? { adj: a, cells: [] }
            g.cells.push(i)
            groups.set(JSON.stringify(a), g)
          }
          const cells = scan.cells.slice()
          for (const { adj, cells: idx } of groups.values()) {
            const crops = idx.map((i) => scan.cells[i]).map(({ index, width, height, gray }) => ({ index, width, height, gray }))
            const results = await retraceCells(crops, { ...adj, thickness: adj.thickness + ref.current.generate.boldAmount })
            for (const r of results) cells[r.index] = r
          }
          if (boldSignature.current !== sig) return // overtaken by a newer change
          setBoldScans((m) => new Map(m).set(u.key, { ...scan, cells }))
        }
      } finally {
        setBusy((n) => n - 1)
      }
    }, BOLD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [uploads, scans, adjust, overrides, generate.bold, generate.boldAmount])

  const boldFromRegular = useMemo(() => {
    if (!generate.bold) return null
    const pages = new Map<number, PageScan>()
    for (let page = 0; page < TEMPLATE_PAGES.length; page++) {
      const list = uploads
        .filter((u) => u.status === 'done' && u.slot?.style === 'regular' && u.slot.page === page && boldScans.has(u.key))
        .map((u) => ({ key: u.key, scan: boldScans.get(u.key)! }))
      const m = mergeUploads(page, list)
      if (m) pages.set(page, m.scan)
    }
    return pages.size ? assembleGlyphs(pages, 'regular') : null
  }, [uploads, boldScans, generate.bold])

  const written = useMemo<GlyphsByStyle>(() => {
    const out = emptyByStyle()
    for (const style of STYLE_IDS) out[style] = assembleGlyphs(merged.byStyle.get(style)!, style)
    return out
  }, [merged])

  const glyphs = useMemo(() => effectiveGlyphs(written, boldFromRegular, generate), [written, boldFromRegular, generate])
  const ligatures = useMemo(() => assembleLigatures(merged.ligatureSheets, ligatureSettings), [merged, ligatureSettings])
  const ligatureSheetsUploaded = useMemo(() => new Set(merged.ligatureSheets.keys()), [merged])
  const uploadedStyles = useMemo(() => new Set(STYLE_IDS.filter((s) => merged.byStyle.get(s)!.size > 0)), [merged])

  // ----------------------------------------------------------- autosave -----

  // Restore once on startup (guarded: React's dev mode runs effects twice).
  useEffect(() => {
    if (restoreStarted.current) return
    restoreStarted.current = true
    void loadProject().then((p) => {
      if (p) {
        setAdjustState(p.adjust)
        setOverrides(p.overrides)
        setMetricsState(p.metrics)
        setGenerate(p.generate)
        setRedo(new Set(p.redo))
        setFont(p.font)
        setPreviewText(p.previewText)
        setPreviewSize(p.previewSize)
        if (p.ligatures) setLigatureSettings(p.ligatures)
        // Settings land before the scans start, so each page is processed with them.
        ref.current.adjust = p.adjust
        ref.current.overrides = p.overrides
        for (const sf of p.files) addFile(new File([sf.blob], sf.name, { type: sf.type }), { pickedSlot: sf.pickedSlot, restoring: true })
        if (p.files.length) setRestored({ files: p.files.length, savedAt: p.savedAt })
      }
      loaded.current = true
    })
  }, [addFile])

  // Save (debounced) whenever anything worth keeping changes.
  useEffect(() => {
    if (!loaded.current) return
    const timer = setTimeout(() => {
      const saved: SavedProject = {
        version: 1,
        savedAt: Date.now(),
        files: uploads.flatMap((u) => {
          const file = files.current.get(u.key)
          if (!file || u.status === 'error') return []
          return [{ name: file.name, type: file.type, blob: file, pickedSlot: u.needsPagePick ? u.slot : null }]
        }),
        adjust,
        overrides,
        metrics,
        generate,
        redo: [...redo],
        font,
        previewText,
        previewSize,
        ligatures: ligatureSettings,
      }
      void saveProject(saved)
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [uploads, adjust, overrides, metrics, generate, redo, font, previewText, previewSize, ligatureSettings])

  const setLigatureText = useCallback((key: string, text: string) => {
    setLigatureSettings((l) => ({ ...l, texts: { ...l.texts, [key]: text } }))
  }, [])
  const setLigatureFeature = useCallback((key: string, feature: LigatureFeature) => {
    setLigatureSettings((l) => ({ ...l, features: { ...l.features, [key]: feature } }))
  }, [])

  const setMetrics = useCallback((key: string, m: GlyphMetrics | null) => {
    setMetricsState((all) => {
      const next = { ...all }
      if (m && !isDefaultMetrics(m)) next[key] = m
      else delete next[key]
      return next
    })
  }, [])

  const startOver = useCallback(async () => {
    loaded.current = false
    await clearProject()
    window.location.reload()
  }, [])

  return {
    ligatures,
    ligatureSheetsUploaded,
    setLigatureText,
    setLigatureFeature,
    metrics,
    font,
    previewText,
    previewSize,
    restored,
    setMetrics,
    setFont,
    setPreviewText,
    setPreviewSize,
    startOver,
    uploads,
    written,
    glyphs,
    uploadedStyles,
    adjust,
    overrides,
    generate,
    redo,
    busy,
    addFiles,
    removeUpload,
    pickSlot,
    setAdjust: setAdjustState,
    setOverride,
    applyToAll,
    setGenerate,
    toggleRedo,
    clearRedo: () => setRedo(new Set()),
  }
}
