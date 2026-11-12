import { describe, expect, it } from 'vitest'
import { crc32, makeZip } from '../../src/core/zip'
import { readStoredZip } from './helpers/readZip'

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('round-trips stored entries with UTF-8 names', () => {
    const a = new TextEncoder().encode('%PDF-1.7 first')
    const b = new Uint8Array(1000).map((_, i) => i % 251)
    const zip = makeZip([
      { name: 'page-1.pdf', data: a },
      { name: 'página-2.pdf', data: b },
    ])
    const entries = readStoredZip(zip)
    expect(entries.map((e) => e.name)).toEqual(['page-1.pdf', 'página-2.pdf'])
    expect(entries[0].data).toEqual(a)
    expect(entries[1].data).toEqual(b)
  })
})
