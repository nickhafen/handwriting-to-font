// End-to-end: the project survives a reload; "Start over" clears it; per-letter
// position; preview slider reset.
import { expect, test, type Page } from '@playwright/test'

type Hw = { makeFixture(s: unknown): Promise<{ base64: string; type: string }> }

async function fixture(page: Page, spec: Record<string, unknown>) {
  await page.goto('dev/fixtures.html')
  await page.waitForFunction(() => 'hw' in window)
  const fx = await page.evaluate((s) => (window as unknown as { hw: Hw }).hw.makeFixture(s), spec)
  return { name: `p${spec.pageIndex}.png`, mimeType: fx.type, buffer: Buffer.from(fx.base64, 'base64') }
}

const glyph = (page: Page, ch: string) => page.locator(`[data-testid="glyph"][data-char="${ch}"]`)
const done = (page: Page) => page.locator('[data-testid="upload-row"][data-status="done"]')

test('the project, its settings and per-letter changes survive a reload', async ({ page }) => {
  const p2 = await fixture(page, { pageIndex: 1 })
  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles([p2])
  await expect(done(page)).toHaveCount(1, { timeout: 60_000 })

  // Move the hyphen down, thicken the 1, mark ? for redo, and change the font name.
  await glyph(page, '-').click()
  const dash = page.getByRole('dialog')
  await dash.locator('#pos-45-shiftY').fill('-60')
  await expect(glyph(page, '-')).toContainText('adjusted')
  await expect(glyph(page, '-').locator('path')).toHaveAttribute('transform', 'translate(0 60)')
  await dash.getByRole('button', { name: 'Next letter' }).click() // the en dash
  await page.keyboard.press('Escape')
  await glyph(page, '1').click()
  await page.locator('#letter-49-thickness').fill('1')
  await page.getByRole('dialog').getByLabel('Mark for a redo sheet').check()
  await page.keyboard.press('Escape')
  await page.getByLabel('Font name').fill('Nick Hand')
  await page.waitForTimeout(1200) // autosave is debounced

  await page.reload()
  await expect(page.getByTestId('autosave-note')).toContainText('Restored your project', { timeout: 10_000 })
  await expect(done(page)).toHaveCount(1, { timeout: 60_000 })
  await expect(page.getByTestId('upload-row')).toContainText('Page 2 (numbers and punctuation) detected')
  await expect(glyph(page, '-')).toContainText('adjusted')
  await expect(glyph(page, '-').locator('path')).toHaveAttribute('transform', 'translate(0 60)')
  await expect(glyph(page, '1')).toContainText('adjusted')
  await expect(glyph(page, '1')).toContainText('redo')
  await expect(page.getByLabel('Font name')).toHaveValue('Nick Hand')

  // Start over clears everything.
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Start over' }).click()
  await page.waitForLoadState('load')
  await expect(page.getByTestId('upload-row')).toHaveCount(0)
  await expect(page.getByTestId('autosave-note')).not.toContainText('Restored')
  await expect(page.getByLabel('Font name')).toHaveCount(0) // step 4 is empty again
})

test('preview sliders reset to their defaults', async ({ page }) => {
  const p1 = await fixture(page, { pageIndex: 0 })
  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles([p1])
  await expect(done(page)).toHaveCount(1, { timeout: 60_000 })
  const reset = page.getByRole('button', { name: 'Reset to defaults' }).last()
  await expect(reset).toBeDisabled()
  const letter = page.locator('section[aria-labelledby="step-preview"] input[type="range"]').nth(1)
  await expect(letter).toHaveValue('-20')
  await letter.fill('40')
  await expect(reset).toBeEnabled()
  await reset.click()
  await expect(letter).toHaveValue('-20')
  await expect(reset).toBeDisabled()
})
