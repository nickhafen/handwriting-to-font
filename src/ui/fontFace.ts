// Browser-only font helpers (kept out of core/ because they need the DOM).

let counter = 0

export interface PreviewFace {
  family: string
  face: FontFace
}

/**
 * Load a built font through the FontFace API. Chrome runs the OpenType
 * Sanitizer here, so if this resolves, browsers accept the font.
 */
export async function loadPreviewFont(buffer: ArrayBuffer): Promise<PreviewFace> {
  const family = `hw-preview-${++counter}`
  const face = new FontFace(family, buffer)
  await face.load()
  document.fonts.add(face)
  return { family, face }
}

export function unloadPreviewFont(p: PreviewFace | null): void {
  if (p) document.fonts.delete(p.face)
}

export function downloadBlob(data: BlobPart, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
