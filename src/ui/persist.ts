// Autosave: the project (uploaded images plus every setting) lives in this
// browser's IndexedDB, so a reload or a later visit picks up where you left off.
// Nothing is sent anywhere.
import { del, get, set } from 'idb-keyval'
import type { FontSettings, GenerateSettings, GlyphMetrics } from '../core/project'
import type { InkAdjust } from '../core/scan/adjust'
import type { Slot } from '../core/template/styles'

const KEY = 'handwriting-to-font:project:v1'

export interface SavedFile {
  name: string
  type: string
  blob: Blob
  /** A page the user chose by hand because its page ID couldn't be read. */
  pickedSlot: Slot | null
}

export interface SavedProject {
  version: 1
  savedAt: number
  files: SavedFile[]
  adjust: InkAdjust
  overrides: Record<string, InkAdjust>
  metrics: Record<string, GlyphMetrics>
  generate: GenerateSettings
  redo: string[]
  font: FontSettings
  previewText: string
  previewSize: number
}

export async function loadProject(): Promise<SavedProject | null> {
  try {
    const p = await get<SavedProject>(KEY)
    return p?.version === 1 ? p : null
  } catch {
    return null // storage unavailable (e.g. private browsing): just don't restore
  }
}

export async function saveProject(p: SavedProject): Promise<void> {
  try {
    await set(KEY, p)
  } catch {
    // Out of space or storage blocked: keep working without autosave.
  }
}

export function clearProject(): Promise<void> {
  return del(KEY)
}
