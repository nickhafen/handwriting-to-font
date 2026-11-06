// End-to-end: upload synthetic scans -> preview -> download the OTF -> re-parse it in Node and check it.
import { expect, test, type Download } from '@playwright/test'
import { readFileSync } from 'node:fs'
import * as opentype from 'opentype.js'
import { commandsToContours } from '../../src/core/font/pathCommands'
import { CHARSET } from '../../src/core/template/charset'
import { flatten, nestingDepths, polygonArea, windingProblems } from '../../src/core/trace/winding'

// In plain Node, opentype.js resolves to its CommonJS build, so the API sits on `default`.
const ot = ((opentype as unknown as { default?: typeof opentype }).default ?? opentype) as typeof opentype

test('build, preview and download a font from two uploaded pages', async ({ page }) => {
  await page.goto('dev/fixtures.html')
  await page.waitForFunction(() => 'hw' in window)
  const specs = [
    { name: 'font-p1.jpg', spec: { pageIndex: 0, rotate: 4, skew: 0.02, shade: 0.7, noise: 8, tint: true, format: 'jpeg' as const, seed: 11 } },
    { name: 'font-p2.png', spec: { pageIndex: 1, skip: ['‘', '“'] } },
  ]
  const files = []
  for (const { name, spec } of specs) {
    const fx = await page.evaluate((s) => (window as unknown as { hw: { makeFixture(s: unknown): Promise<{ base64: string; type: string }> } }).hw.makeFixture(s), spec)
    files.push({ name, mimeType: fx.type, buffer: Buffer.from(fx.base64, 'base64') })
  }

  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles(files)
  await expect(page.locator('[data-testid="upload-row"][data-status="done"]')).toHaveCount(2, { timeout: 60_000 })

  // The preview font builds, passes every check, and the browser accepts it.
  const checks = page.getByTestId('font-checks')
  await expect(checks).toContainText('104 of 104 characters in the font', { timeout: 30_000 })
  await expect(checks).toContainText('Your browser accepted the font')
  await expect(checks).toContainText('Letter holes (o, e, a, 8…) are set up correctly')
  const family = await page.getByTestId('font-preview').evaluate((el) => getComputedStyle(el).fontFamily)
  expect(family).toContain('hw-preview-')

  // Download and re-parse.
  // Bold and italics are generated from Regular by default, so four files download with one build code.
  const downloads: Download[] = []
  page.on('download', (d) => downloads.push(d))
  await page.getByRole('button', { name: 'Download 4 font files' }).click()
  await expect.poll(() => downloads.length, { timeout: 10_000 }).toBe(4)
  const names = downloads.map((d) => d.suggestedFilename())
  expect(names[0]).toMatch(/^MyHandwriting[0-9A-Z]{4}-Regular\.otf$/)
  const code = names[0].slice('MyHandwriting'.length, 'MyHandwriting'.length + 4)
  expect(names).toEqual(['Regular', 'Bold', 'Italic', 'BoldItalic'].map((s) => `MyHandwriting${code}-${s}.otf`))
  const parseDownload = async (d: Download) => {
    const bytes = readFileSync(await d.path())
    return ot.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  }
  const font = await parseDownload(downloads[0])

  // The other styles share the family name and carry the right style flags, so Word links them.
  const styles = await Promise.all(downloads.slice(1).map(parseDownload))
  for (const [f, name, weight, italic] of [
    [styles[0], 'Bold', 700, false],
    [styles[1], 'Italic', 400, true],
    [styles[2], 'Bold Italic', 700, true],
  ] as const) {
    expect(f.names.fontFamily?.en ?? f.names.windows?.fontFamily?.en).toBe(`My Handwriting ${code}`)
    expect(f.names.fontSubfamily?.en ?? f.names.windows?.fontSubfamily?.en).toBe(name)
    expect(f.tables.os2.usWeightClass).toBe(weight)
    expect((f.tables.os2.fsSelection & 1) === 1).toBe(italic) // ITALIC bit
    expect((f.tables.os2.fsSelection & 32) === 32).toBe(weight === 700) // BOLD bit
    expect(f.tables.post.italicAngle < 0).toBe(italic)
  }
  // Generated bold is heavier; generated italic leans right.
  const inkWidth = (f: typeof font, ch: string) => f.charToGlyph(ch).getBoundingBox().x2 - f.charToGlyph(ch).getBoundingBox().x1
  expect(inkWidth(styles[0], 'l')).toBeGreaterThan(inkWidth(font, 'l') + 5)
  expect(inkWidth(styles[1], 'l')).toBeGreaterThan(inkWidth(font, 'l') + 60)

  expect(font.tables.cff).toBeDefined()
  expect(font.names.fontFamily?.en ?? font.names.windows?.fontFamily?.en).toMatch(/^My Handwriting [0-9A-Z]{4}$/)
  expect(font.tables.os2.fsType).toBe(0)
  for (const ch of [' ', ...CHARSET.map((c) => c.char)]) expect(font.charToGlyphIndex(ch), `cmap for ${ch}`).toBeGreaterThan(0)

  let yMax = -Infinity
  let yMin = Infinity
  for (let i = 0; i < font.glyphs.length; i++) {
    const g = font.glyphs.get(i)
    const bb = g.getBoundingBox()
    if (bb.isEmpty()) continue
    yMax = Math.max(yMax, bb.y2)
    yMin = Math.min(yMin, bb.y1)
    expect(windingProblems(commandsToContours(g.path.commands)), `winding of ${g.name}`).toEqual([])
  }
  expect(font.tables.os2.usWinAscent).toBeGreaterThanOrEqual(yMax)
  expect(font.tables.os2.usWinDescent).toBeGreaterThanOrEqual(-yMin)

  // Letters with holes: an outer contour counter-clockwise with a clockwise hole inside.
  for (const ch of ['o', 'e', 'a', '8', 'Q', '@', '%']) {
    const contours = commandsToContours(font.charToGlyph(ch).path.commands)
    const depths = nestingDepths(contours)
    expect(depths.some((d) => d > 0), `${ch} has a hole`).toBe(true)
    contours.forEach((c, i) => expect(Math.sign(polygonArea(flatten(c))), `${ch} contour ${i}`).toBe(depths[i] % 2 === 0 ? 1 : -1))
  }

  // Baselines: "x" sits on the baseline, "g" and "p" have tails below it.
  const bbox = (ch: string) => font.charToGlyph(ch).getBoundingBox()
  expect(Math.abs(bbox('x').y1)).toBeLessThan(70)
  expect(bbox('g').y1).toBeLessThan(-150)
  expect(bbox('p').y1).toBeLessThan(-150)
  expect(bbox('H').y2).toBeGreaterThan(600)

  // Blank curly quotes reuse the straight quote outlines.
  expect(font.charToGlyph('‘').path.commands).toEqual(font.charToGlyph("'").path.commands)
  expect(font.charToGlyph('‘').name).toBe('quoteleft')

  // Sidebearings: ink starts 50 units in, and the advance adds 50 on the right.
  const o = font.charToGlyph('o')
  expect(Math.abs(o.getBoundingBox().x1 - 50)).toBeLessThan(2) // coordinates are rounded to whole units
  expect(Math.abs(o.advanceWidth - (o.getBoundingBox().x2 + 50))).toBeLessThan(2)
  expect(font.charToGlyph(' ').advanceWidth).toBe(280)
})
