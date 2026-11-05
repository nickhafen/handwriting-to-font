// The v1 character set, its glyph names, and which page/cell each character uses.
import { CELLS_PER_PAGE, GRID } from './layout'

export interface CharInfo {
  char: string
  unicode: number
  /** Adobe Glyph List name. */
  glyphName: string
  /** Short description printed in the label strip for characters that are easy to confuse. */
  hint?: string
  /** If left blank, copy this character's glyph instead (curly quotes fall back to straight ones). */
  fallbackFrom?: string
}

const AGL: Record<string, string> = {
  '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
  '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  '!': 'exclam', '"': 'quotedbl', '#': 'numbersign', '$': 'dollar', '%': 'percent',
  '&': 'ampersand', "'": 'quotesingle', '(': 'parenleft', ')': 'parenright', '*': 'asterisk',
  '+': 'plus', ',': 'comma', '-': 'hyphen', '.': 'period', '/': 'slash',
  ':': 'colon', ';': 'semicolon', '<': 'less', '=': 'equal', '>': 'greater',
  '?': 'question', '@': 'at', '[': 'bracketleft', '\\': 'backslash', ']': 'bracketright',
  '^': 'asciicircum', '_': 'underscore', '`': 'grave', '{': 'braceleft', '|': 'bar',
  '}': 'braceright', '~': 'asciitilde',
  '‘': 'quoteleft', '’': 'quoteright', '“': 'quotedblleft', '”': 'quotedblright',
  '–': 'endash', '—': 'emdash', '…': 'ellipsis', '§': 'section', '•': 'bullet',
}

const HINTS: Record<string, string> = {
  I: 'capital i', O: 'capital o', l: 'small L', o: 'small o', '0': 'zero', '1': 'one',
  '.': 'period', ',': 'comma', ';': 'semicolon', ':': 'colon',
  "'": 'straight apostrophe', '"': 'straight quotes',
  '‘': 'left single quote', '’': 'right quote / apostrophe',
  '“': 'left double quote', '”': 'right double quote',
  '-': 'hyphen', '–': 'en dash', '—': 'em dash', '…': 'ellipsis (3 dots)',
  '/': 'slash', '\\': 'backslash', '|': 'vertical bar', _: 'underscore',
  '^': 'caret', '~': 'tilde', '`': 'backtick', '§': 'section', '•': 'bullet',
}

const FALLBACKS: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
}

function info(char: string): CharInfo {
  const glyphName = /^[A-Za-z]$/.test(char) ? char : AGL[char]
  if (!glyphName) throw new Error(`No glyph name for ${JSON.stringify(char)}`)
  return {
    char,
    unicode: char.codePointAt(0)!,
    glyphName,
    ...(HINTS[char] && { hint: HINTS[char] }),
    ...(FALLBACKS[char] && { fallbackFrom: FALLBACKS[char] }),
  }
}

const range = (from: string, to: string) =>
  Array.from({ length: to.charCodeAt(0) - from.charCodeAt(0) + 1 }, (_, i) =>
    String.fromCharCode(from.charCodeAt(0) + i),
  )

/**
 * Pages, each a list of sections. Each section starts on a new grid row.
 * Punctuation is grouped so related marks (straight and curly quotes, dashes) sit together.
 */
const PAGE_SECTIONS: string[][][] = [
  [range('A', 'Z'), range('a', 'z')],
  [
    range('0', '9'),
    [
      '.', ',', ';', ':', '!', '?',
      "'", '"', '‘', '’', '“', '”',
      '-', '–', '—', '…',
      '(', ')', '[', ']', '{', '}',
      '/', '\\', '|', '_',
      '@', '#', '$', '%', '&', '*',
      '+', '=', '<', '>', '^', '~', '`',
      '§', '•',
    ],
  ],
]

export interface TemplatePage {
  index: number
  /** One entry per grid cell; null = unused cell (not drawn). */
  cells: (CharInfo | null)[]
}

function layoutPage(index: number, sections: string[][]): TemplatePage {
  const cells: (CharInfo | null)[] = []
  for (const section of sections) {
    while (cells.length % GRID.cols !== 0) cells.push(null)
    for (const ch of section) cells.push(info(ch))
  }
  if (cells.length > CELLS_PER_PAGE) {
    throw new Error(`Template page ${index + 1} needs ${cells.length} cells but only has ${CELLS_PER_PAGE}`)
  }
  while (cells.length < CELLS_PER_PAGE) cells.push(null)
  return { index, cells }
}

export const TEMPLATE_PAGES: TemplatePage[] = PAGE_SECTIONS.map((s, i) => layoutPage(i, s))

/** Every character in the template, in page order. */
export const CHARSET: CharInfo[] = TEMPLATE_PAGES.flatMap((p) => p.cells.filter((c): c is CharInfo => c !== null))
