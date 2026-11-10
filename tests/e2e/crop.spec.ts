// End-to-end: cropping a stray pen mark out of one letter (and one ligature box),
// independently of the ink settings; the crop survives a reload and can be removed.
import { expect, test, type Locator, type Page } from '@playwright/test'

type Hw = { makeFixture(s: unknown): Promise<{ base64: string; type: string }> }

async function fixture(page: Page, name: string, spec: Record<string, unknown>) {
  await page.goto('dev/fixtures.html')
  await page.waitForFunction(() => 'hw' in window)
  const fx = await page.evaluate((s) => (window as unknown as { hw: Hw }).hw.makeFixture(s), spec)
  return { name, mimeType: fx.type, buffer: Buffer.from(fx.base64, 'base64') }
}

const done = (page: Page) => page.locator('[data-testid="upload-row"][data-status="done"]')
const widthOf = (tile: Locator) => tile.getAttribute('data-ink-width').then(Number)

/** Drag across the drawer's scan image, from and to fractions of its size. */
async function dragCrop(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByRole('dialog').getByTestId('crop-frame').boundingBox())!
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2), { steps: 4 })
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 4 })
  await page.mouse.up()
}

// The writing stays in the middle 80% of each box; the stray mark is at 93–95.5%.
const KEEP_FROM: [number, number] = [0.02, 0.02]
const KEEP_TO: [number, number] = [0.91, 0.98]

test('a stray mark can be cropped out of a letter, and the crop is saved', async ({ page }) => {
  const p1 = await fixture(page, 'p1.png', { pageIndex: 0, stray: ['l'] })
  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles([p1])
  await expect(done(page)).toHaveCount(1, { timeout: 60_000 })

  const l = page.locator('[data-testid="glyph"][data-char="l"]')
  const k = page.locator('[data-testid="glyph"][data-char="k"]')
  const wide = await widthOf(l)
  const kWidth = await widthOf(k)
  expect(wide).toBeGreaterThan(kWidth) // the stray mark makes "l" wider than "k"

  await l.click()
  await expect(page.getByRole('dialog')).toContainText('drag to crop')
  // A click without dragging changes nothing.
  await page.getByRole('dialog').getByTestId('crop-frame').click()
  await expect(page.getByRole('dialog').getByTestId('crop-rect')).toHaveCount(0)

  await dragCrop(page, KEEP_FROM, KEEP_TO)
  await expect(page.getByRole('dialog').getByTestId('crop-rect')).toBeVisible()
  await expect.poll(() => widthOf(l), { timeout: 20_000 }).toBeLessThan(wide * 0.5)
  const narrow = await widthOf(l)
  await expect(l).toContainText('adjusted')
  // Only this letter was re-traced; ink settings were not touched.
  expect(await widthOf(k)).toBe(kWidth)
  await expect(page.locator('.ink-panel summary')).not.toContainText('changed from default')
  await page.keyboard.press('Escape')

  // The crop is autosaved and re-applied after a reload.
  await page.waitForTimeout(1200)
  await page.reload()
  await expect(done(page)).toHaveCount(1, { timeout: 60_000 })
  await expect.poll(() => widthOf(l), { timeout: 20_000 }).toBe(narrow)
  await expect(l).toContainText('adjusted')

  // Removing the crop brings the mark back.
  await l.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove crop' }).click()
  await expect.poll(() => widthOf(l), { timeout: 20_000 }).toBe(wide)
  await expect(l).not.toContainText('adjusted')
  await expect(page.getByRole('dialog').getByTestId('crop-rect')).toHaveCount(0)
})

test('ligature boxes can be cropped too', async ({ page }) => {
  // The Ligatures tab shows next to a letters page.
  const p1 = await fixture(page, 'p1.png', { pageIndex: 0 })
  const sheet = await fixture(page, 'common.png', { ligatureSheet: 0, stray: ['th'] })
  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles([p1, sheet])
  await expect(done(page)).toHaveCount(2, { timeout: 90_000 })
  await page.getByRole('tab', { name: 'Ligatures' }).click()

  const th = page.locator('[data-testid="ligature"][data-key="lig:0:10"]')
  const wide = await widthOf(th)
  await th.getByRole('button').click()
  await dragCrop(page, KEEP_FROM, KEEP_TO)
  await expect.poll(() => widthOf(th), { timeout: 20_000 }).toBeLessThan(wide * 0.9)
  await expect(th).toContainText('adjusted')
})
