// End-to-end: redo sheets merge into earlier uploads, the review drawer's
// "apply to all", the preview's insert buttons, and the dev "Load samples" button.
import { expect, test, type Page } from '@playwright/test'
import { CHARSET } from '../../src/core/template/charset'

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

const glyph = (page: Page, ch: string) => page.locator(`[data-testid="glyph"][data-char="${ch}"]`)
const row = (page: Page, name: string) => page.getByTestId('upload-row').filter({ hasText: name })

test('a redo sheet replaces only the characters written on it', async ({ page }) => {
  const redoOnly = ['A', 'g']
  const [full, redo] = await makeFiles(page, [
    { name: 'page1.png', spec: { pageIndex: 0 } },
    // A "redo sheet": only A and g are written, slightly rotated so their outlines differ.
    { name: 'redo.png', spec: { pageIndex: 0, rotate: 2, skip: CHARSET.map((c) => c.char).filter((c) => !redoOnly.includes(c)) } },
  ])
  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles([full])
  await expect(row(page, 'page1.png')).toHaveAttribute('data-status', 'done', { timeout: 60_000 })
  await expect(row(page, 'page1.png')).toContainText('Supplies 52 characters')

  // Mark A and g for redo in the drawer; the template step lists them.
  for (const ch of redoOnly) {
    await glyph(page, ch).click()
    await page.getByRole('dialog').getByLabel('Mark for a redo sheet').check()
    await expect(glyph(page, ch)).toContainText('redo')
  }
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('redo-marked')).toContainText('A g')

  const before = await page.evaluate(() => [...document.querySelectorAll('[data-char="A"] svg path, [data-char="B"] svg path')].map((p) => p.getAttribute('d')))

  await page.getByTestId('upload-input').setInputFiles([redo])
  await expect(row(page, 'redo.png')).toContainText('Supplies 2 characters', { timeout: 60_000 })
  await expect(row(page, 'page1.png')).toContainText('Supplies 50 characters')
  // Marks for the redone characters clear themselves.
  await expect(page.getByTestId('redo-marked')).toHaveCount(0)
  await expect(glyph(page, 'A')).not.toContainText('redo')

  const after = await page.evaluate(() => [...document.querySelectorAll('[data-char="A"] svg path, [data-char="B"] svg path')].map((p) => p.getAttribute('d')))
  expect(after[0]).not.toBe(before[0]) // A came from the redo sheet
  expect(after[1]).toBe(before[1]) // B kept the original
  await expect(page.getByTestId('review-summary')).toContainText('52 of 103 characters ready')
})

test('apply one letter’s settings to all letters, and insert special characters', async ({ page }) => {
  const [p1] = await makeFiles(page, [{ name: 'p1.png', spec: { pageIndex: 0 } }])
  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles([p1])
  await expect(page.locator('[data-testid="upload-row"][data-status="done"]')).toHaveCount(1, { timeout: 60_000 })

  const inkB = Number(await glyph(page, 'B').getAttribute('data-ink'))
  await glyph(page, 'A').click()
  await page.locator('#letter-65-thickness').fill('1.5')
  await expect(glyph(page, 'A')).toContainText('adjusted')
  await page.getByRole('button', { name: 'Apply to all letters' }).click()
  await expect(glyph(page, 'A')).not.toContainText('adjusted')
  await expect(page.locator('.ink-panel summary')).toContainText('changed from default')
  await expect.poll(async () => Number(await glyph(page, 'B').getAttribute('data-ink')), { timeout: 20_000 }).toBeGreaterThan(inkB * 1.1)
  await page.getByRole('button', { name: 'Close' }).click()

  const box = page.getByLabel('Preview text')
  await box.fill('a')
  await page.getByRole('button', { name: 'Insert em dash' }).click()
  await page.getByRole('button', { name: 'Insert section sign' }).click()
  await page.getByRole('button', { name: 'Insert bullet' }).click()
  await page.getByRole('button', { name: 'Insert en dash' }).click()
  await expect(box).toHaveValue('a—§•–')
})

test('dev "Load samples" loads the color samples', async ({ page, request }) => {
  const list = await (await request.get('__samples')).json()
  test.skip(!list.some((n: string) => /color/i.test(n)), 'No color samples in ./samples')
  await page.goto('./')
  await page.getByTestId('load-samples').click()
  const n = list.filter((n: string) => /color/i.test(n)).length
  await expect(page.locator('[data-testid="upload-row"][data-status="done"]')).toHaveCount(n, { timeout: 90_000 })
  await expect(page.getByTestId('upload-row').first()).toContainText('detected')
})
