// End-to-end: clear messages when the page is out of date, and named, non-blocking line warnings.
import { expect, test } from '@playwright/test'

type Hw = { makeFixture(s: unknown): Promise<{ base64: string; type: string }> }

test('an out-of-date page says so and offers a reload', async ({ page }) => {
  await page.goto('./')
  // Simulate a server that no longer has the PDF code this page expects.
  await page.route('**/generatePdf*', (r) => r.abort())
  await page.getByRole('button', { name: 'Download PDF' }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('This page is out of date')
  await expect(alert.getByRole('button', { name: 'Reload page' })).toBeVisible()
})

test('a letter pushed past the bottom line is flagged in step 3 and named in step 4', async ({ page }) => {
  await page.goto('dev/fixtures.html')
  await page.waitForFunction(() => 'hw' in window)
  const fx = await page.evaluate((s) => (window as unknown as { hw: Hw }).hw.makeFixture(s), { pageIndex: 0 })
  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles([{ name: 'p1.png', mimeType: fx.type, buffer: Buffer.from(fx.base64, 'base64') }])
  await expect(page.locator('[data-testid="upload-row"][data-status="done"]')).toHaveCount(1, { timeout: 60_000 })

  const g = page.locator('[data-testid="glyph"][data-char="g"]')
  await g.click()
  await page.locator('#pos-103-shiftY').fill('-200')
  await expect(g).toContainText('past bottom line')
  await page.keyboard.press('Escape')

  await expect(page.getByTestId('font-checks')).toContainText('“g” reaches below the template’s bottom line', { timeout: 20_000 })
  // A warning doesn't block the download.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Download \d+ font files|Download OTF/ }).click()
  await download
  await expect(page.getByTestId('download-problems')).toHaveCount(0)
})
