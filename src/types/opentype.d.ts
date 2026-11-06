// Minimal type declarations for opentype.js 2.x (the package ships no types).
// Covers only the parts of the API this app uses.
declare module 'opentype.js' {
  export type PathCommand =
    | { type: 'M'; x: number; y: number }
    | { type: 'L'; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Q'; x1: number; y1: number; x: number; y: number }
    | { type: 'Z' }

  export class BoundingBox {
    x1: number
    y1: number
    x2: number
    y2: number
    isEmpty(): boolean
  }

  export class Path {
    commands: PathCommand[]
    moveTo(x: number, y: number): void
    lineTo(x: number, y: number): void
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void
    quadraticCurveTo(x1: number, y1: number, x: number, y: number): void
    close(): void
    getBoundingBox(): BoundingBox
  }

  export interface GlyphOptions {
    name: string
    unicode?: number
    unicodes?: number[]
    advanceWidth: number
    path?: Path
  }

  export class Glyph {
    constructor(options: GlyphOptions)
    index: number
    name: string | null
    unicode: number | undefined
    unicodes: number[]
    advanceWidth: number
    path: Path
    getBoundingBox(): BoundingBox
  }

  export interface GlyphSet {
    length: number
    get(index: number): Glyph
  }

  export interface FontOptions {
    familyName: string
    styleName: string
    unitsPerEm: number
    ascender: number
    descender: number
    glyphs: Glyph[]
    designer?: string
    version?: string
    weightClass?: number
    italicAngle?: number
    tables?: { os2?: Record<string, number> }
  }

  export class Font {
    constructor(options: FontOptions)
    unitsPerEm: number
    ascender: number
    descender: number
    glyphs: GlyphSet
    // Parsed tables (head, hhea, os2, cmap, name, ...). Shape varies by table.
    tables: Record<string, any>
    names: Record<string, any>
    charToGlyph(c: string): Glyph
    charToGlyphIndex(c: string): number
    hasChar(c: string): boolean
    toArrayBuffer(): ArrayBuffer
  }

  export function parse(buffer: ArrayBuffer, options?: Record<string, unknown>): Font
}
