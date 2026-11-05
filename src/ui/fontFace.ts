// Browser-only font helpers (kept out of core/ because they need the DOM).

let counter = 0

/**
 * Load a built font through the FontFace API. Chrome runs the OpenType
 * Sanitizer here, so if this resolves, browsers accept the font.
 * Returns the CSS family name to use for previews.
 */
export async function loadPreviewFont(buffer: ArrayBuffer): Promise<string> {
  const family = `hw-preview-${++counter}`
  const face = new FontFace(family, buffer)
  await face.load()
  document.fonts.add(face)
  return family
}

export function downloadBlob(data: ArrayBuffer, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
