// End-to-end: faint-pen scans, the "all letters" ink controls, and per-letter overrides.
import { expect, test, type Page } from '@playwright/test'

type Hw = {
  makeFixture(s: unknown): Promise<{ base64: string; type: string }>
  scan(b64: string, type: string): Promise<{ cells: { char: string | null; empty: boolean; yMin: number | null }[] }>
}

const FAINT = { pageIndex: 0, faint: true, rotate: 3, skew: 0.015, shade: 0.8, noise: 6, tint: true, format: 'jpeg', seed: 21 }

async function fixture(page: Page) {
  await page.goto('dev/fixtures.html')
  await page.waitForFunction(() => 'hw' in window)
  return page.evaluate((s) => (window as unknown as { hw: Hw }).hw.makeFixture(s), FAINT)
}

const inkOf = (page: Page, ch: string) =>
  page.locator(`[data-testid="glyph"][data-char="${ch}"]`).getAttribute('data-ink').then(Number)

test('faint strokes reach the baseline with the default settings', async ({ page }) => {
  const fx = await fixture(page)
  const r = await page.evaluate(({ base64, type }) => (window as unknown as { hw: Hw }).hw.scan(base64, type), fx)
  const x = r.cells.find((c) => c.char === 'x')!
  const n = r.cells.find((c) => c.char === 'n')!
  // The lightest part of each letter is at the baseline; it must not be dropped.
  expect(Math.abs(x.yMin!)).toBeLessThan(80)
  expect(Math.abs(n.yMin!)).toBeLessThan(80)
  expect(r.cells.filter((c) => c.char && c.empty).map((c) => c.char)).toEqual([])
})

test('ink controls re-trace all letters, and per-letter settings override them', async ({ page }) => {
  const fx = await fixture(page)
  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles([{ name: 'faint.jpg', mimeType: fx.type, buffer: Buffer.from(fx.base64, 'base64') }])
  await expect(page.locator('[data-testid="upload-row"][data-status="done"]')).toHaveCount(1, { timeout: 60_000 })

  const x0 = await inkOf(page, 'x')
  const a0 = await inkOf(page, 'A')
  const b0 = await inkOf(page, 'B')

  // Lowest sensitivity loses the faint lower halves of every letter.
  await page.locator('#all-sensitivity').fill('0')
  await expect.poll(() => inkOf(page, 'x'), { timeout: 20_000 }).toBeLessThan(x0 * 0.8)
  await page.locator('#all-sensitivity').fill('70')
  await expect.poll(() => inkOf(page, 'x'), { timeout: 20_000 }).toBe(x0)

  // Thicken just the A.
  await page.locator('[data-testid="glyph"][data-char="A"]').click()
  await page.locator('#letter-65-thickness').fill('2')
  await expect.poll(() => inkOf(page, 'A'), { timeout: 20_000 }).toBeGreaterThan(a0 * 1.15)
  await expect(page.locator('[data-testid="glyph"][data-char="A"]')).toContainText('adjusted')
  expect(await inkOf(page, 'B')).toBe(b0)

  // A global change leaves the adjusted A alone but updates B.
  await page.locator('#all-thickness').fill('1')
  await expect.poll(() => inkOf(page, 'B'), { timeout: 20_000 }).toBeGreaterThan(b0 * 1.07)
  const aAdjusted = await inkOf(page, 'A')
  expect(aAdjusted).toBeGreaterThan(a0 * 1.15)

  // Reset the A: it follows the all-letters settings again (thickness +1).
  await page.getByRole('button', { name: 'Use the all-letters settings' }).click()
  await expect.poll(() => inkOf(page, 'A'), { timeout: 20_000 }).toBeLessThan(aAdjusted)
  await expect(page.locator('[data-testid="glyph"][data-char="A"]')).not.toContainText('adjusted')
  expect(await inkOf(page, 'A')).toBeGreaterThan(a0)
})
