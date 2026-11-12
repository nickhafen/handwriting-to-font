// End-to-end: an Italic ligature sheet is recognized by its style squares, and
// ligature boxes can be marked for a redo sheet that replaces just those boxes.
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { ligatureBoxes, ligatureSheetId } from '../../src/core/template/ligatures'

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

const row = (page: Page, name: string) => page.getByTestId('upload-row').filter({ hasText: name })
const tile = (page: Page, key: string) => page.locator(`[data-testid="ligature"][data-key="${key}"]`)

const ITALIC_COMMON = ligatureSheetId('italic', 0)
/** Box 11 on the common sheet is "th". */
const TH = 10
/** A common-sheet redo: only "th" written again, slightly rotated so its outline differs. */
const onlyTh = Object.fromEntries(ligatureBoxes(0).map((b) => [b.index, b.index === TH ? 'th' : '']))

test('Italic ligature sheets, and redo sheets for ligature boxes', async ({ page }) => {
  const [p1, common, italic, redo] = await makeFiles(page, [
    { name: 'p1.png', spec: { pageIndex: 0 } },
    { name: 'common.png', spec: { ligatureSheet: 0 } },
    { name: 'italic-common.png', spec: { ligatureSheet: ITALIC_COMMON, rotate: -3, seed: 8 } },
    { name: 'redo.png', spec: { ligatureSheet: 0, ligatureTexts: onlyTh, rotate: 2, seed: 5 } },
  ])
  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles([p1, common, italic])
  await expect(page.locator('[data-testid="upload-row"][data-status="done"]')).toHaveCount(3, { timeout: 90_000 })
  await expect(row(page, 'italic-common.png')).toContainText('Italic common ligatures sheet detected. Supplies 24 boxes.')
  await expect(row(page, 'common.png').first()).toContainText('Common ligatures sheet detected. Supplies 24 boxes.')

  await page.getByRole('tab', { name: 'Ligatures' }).click()
  await expect(page.getByRole('heading', { name: 'Italic common ligatures sheet' })).toBeVisible()
  await expect(tile(page, `lig:${ITALIC_COMMON}:${TH}`).getByTestId('ligature-status')).toHaveText('Replaces “th”')

  // Mark the Regular "th" box for a redo sheet.
  await tile(page, `lig:0:${TH}`).getByRole('button').click()
  await page.getByRole('dialog').getByLabel('Mark for a redo sheet').check()
  await page.keyboard.press('Escape')
  await expect(tile(page, `lig:0:${TH}`)).toContainText('redo')
  await expect(page.getByTestId('redo-marked-ligatures')).toHaveText('Common ligatures sheet: box 11 (th)')

  // The redo sheet is one page.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download redo sheet' }).click()])
  const pdf = await PDFDocument.load(readFileSync(await download.path()))
  expect(pdf.getPageCount()).toBe(1)

  const before = await tile(page, `lig:0:${TH}`).locator('svg path').first().getAttribute('d')
  await page.getByTestId('upload-input').setInputFiles([redo])
  await expect(row(page, 'redo.png')).toContainText('Supplies 1 box', { timeout: 60_000 })
  await expect(row(page, 'common.png').first()).toContainText('Supplies 23 boxes')
  // The mark clears itself, and "th" now comes from the redo sheet.
  await expect(page.getByTestId('redo-marked-ligatures')).toHaveCount(0)
  await expect(tile(page, `lig:0:${TH}`)).not.toContainText('redo')
  await expect.poll(() => tile(page, `lig:0:${TH}`).locator('svg path').first().getAttribute('d')).not.toBe(before)
})
