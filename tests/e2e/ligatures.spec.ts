// End-to-end: common and blank ligature sheets -> typed box texts -> fonts with GSUB ligatures and contextual alternates.
import { expect, test, type Download, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import * as opentype from 'opentype.js'

const ot = ((opentype as unknown as { default?: typeof opentype }).default ?? opentype) as typeof opentype
type Hw = { makeFixture(s: unknown): Promise<{ base64: string; type: string }> }

async function makeFiles(page: Page, specs: { name: string; spec: Record<string, unknown> }[]) {
  await page.goto('dev/fixtures.html')
  await page.waitForFunction(() => 'hw' in window)
  const files = []
  for (const { name, spec } of specs) {
    const fx = await page.evaluate((s) => (window as unknown as { hw: Hw }).hw.makeFixture(s), spec)
    files.push({ name, mimeType: fx.type, buffer: Buffer.from(fx.base64, 'base64') })
  }
  return files
}

const tile = (page: Page, key: string) => page.locator(`[data-testid="ligature"][data-key="${key}"]`)

test('ligature sheets become ligatures and contextual alternates in the font', async ({ page }) => {
  const files = await makeFiles(page, [
    { name: 'p1.png', spec: { pageIndex: 0 } },
    { name: 'p2.png', spec: { pageIndex: 1 } },
    { name: 'common.png', spec: { ligatureSheet: 0, rotate: 2, seed: 4 } },
    // Blank sheet 1: box 1 holds an "e" (to become r[e]); box 15 (a 2-wide box) holds "Th".
    { name: 'blank1.png', spec: { ligatureSheet: 1, ligatureTexts: { 0: 'e', 14: 'Th' } } },
  ])
  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles(files)
  await expect(page.locator('[data-testid="upload-row"][data-status="done"]')).toHaveCount(4, { timeout: 90_000 })
  await expect(page.getByTestId('upload-row').filter({ hasText: 'common.png' })).toContainText('Common ligatures sheet detected. Supplies 24 boxes.')
  await expect(page.getByTestId('upload-row').filter({ hasText: 'blank1.png' })).toContainText('Blank ligature sheet 1 detected. Supplies 2 boxes.')

  await page.getByRole('tab', { name: 'Ligatures' }).click()
  await expect(page.getByTestId('ligature')).toHaveCount(26)
  await expect(tile(page, 'lig:0:10').getByTestId('ligature-status')).toHaveText('Replaces “th”')

  // Type what the blank boxes hold.
  await expect(tile(page, 'lig:1:0').getByTestId('ligature-status')).toHaveText('Type what this box holds')
  await tile(page, 'lig:1:0').getByTestId('ligature-text').fill('e')
  await expect(tile(page, 'lig:1:0').getByTestId('ligature-status')).toContainText('add context')
  await tile(page, 'lig:1:0').getByTestId('ligature-text').fill('r[e]')
  await expect(tile(page, 'lig:1:0').getByTestId('ligature-status')).toHaveText('“e” after “r”')
  await tile(page, 'lig:1:14').getByTestId('ligature-text').fill('Th')
  await expect(tile(page, 'lig:1:14').getByTestId('ligature-status')).toHaveText('Replaces “Th”')
  await expect(page.getByTestId('review-summary')).toContainText('26 ligatures and alternates ready')

  // The drawer works for ligature boxes: make "Th" a bit bigger.
  await tile(page, 'lig:1:14').getByRole('button').click()
  await expect(page.getByRole('dialog', { name: 'Details for box 15' })).toBeVisible()
  await page.locator('#ligpos-1-14-scale').fill('120')
  await expect(tile(page, 'lig:1:14')).toContainText('adjusted')
  await page.keyboard.press('Escape')

  // In the preview, Chrome substitutes the ligature: "Th" changes width when ligatures are switched off.
  await page.getByLabel('Preview text').fill('Th')
  const preview = page.getByTestId('font-preview')
  await expect(page.getByTestId('ligature-mode')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
  const withLig = await preview.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width })
  await page.getByTestId('ligature-mode').selectOption('off')
  const without = await preview.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width })
  expect(Math.abs(withLig - without)).toBeGreaterThan(2)

  // Download and inspect the fonts.
  const downloads: Download[] = []
  page.on('download', (d) => downloads.push(d))
  await page.getByRole('button', { name: 'Download 4 font files' }).click()
  await expect.poll(() => downloads.length, { timeout: 10_000 }).toBe(4)
  const fonts = await Promise.all(
    downloads.map(async (d) => {
      const b = readFileSync(await d.path())
      return ot.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
    }),
  )
  const [regular, bold, italic] = fonts
  const names = (f: typeof regular) => Array.from({ length: f.glyphs.length }, (_, i) => f.glyphs.get(i).name)
  expect(names(regular)).toEqual(expect.arrayContaining(['f_f_i', 'f_f', 't_h', 'i_n_g', 'T_h', 'e.alt1']))
  expect(regular.tables.gsub.features.map((x: { tag: string }) => x.tag)).toEqual(['calt', 'liga'])
  expect(names(italic)).toEqual(expect.arrayContaining(['T_h', 'e.alt1'])) // generated italic gets slanted ligatures
  expect(bold.tables.gsub).toBeUndefined() // bold styles don't get ligatures yet

  // The contextual alternate rule: after r, e becomes e.alt1.
  const gsub = regular.tables.gsub
  const chain = gsub.lookups.find((l: { lookupType: number }) => l.lookupType === 6)
  const rule = chain.subtables[0]
  expect(regular.glyphs.get(rule.backtrackCoverage[0].glyphs[0]).name).toBe('r')
  expect(regular.glyphs.get(rule.inputCoverage[0].glyphs[0]).name).toBe('e')
})
