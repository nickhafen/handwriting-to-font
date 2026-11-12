/** Read a zip of stored (uncompressed) entries by walking its local file headers. Test-only. */
export function readStoredZip(zip: Uint8Array): { name: string; data: Uint8Array }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const out: { name: string; data: Uint8Array }[] = []
  let p = 0
  while (view.getUint32(p, true) === 0x04034b50) {
    if (view.getUint16(p + 8, true) !== 0) throw new Error('Only stored entries are supported')
    const size = view.getUint32(p + 18, true)
    const nameLen = view.getUint16(p + 26, true)
    const extraLen = view.getUint16(p + 28, true)
    const name = new TextDecoder().decode(zip.subarray(p + 30, p + 30 + nameLen))
    const start = p + 30 + nameLen + extraLen
    out.push({ name, data: zip.slice(start, start + size) })
    p = start + size
  }
  if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Central directory not found')
  return out
}
