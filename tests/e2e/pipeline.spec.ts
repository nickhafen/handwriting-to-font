// End-to-end: synthetic scans -> real worker pipeline in Chrome -> assertions.
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface FixtureSpec {
  pageIndex: number
  skip?: string[]
  rotate?: number
  skew?: number
  shade?: number
  shadow?: boolean
  noise?: number
  tint?: boolean
  format?: 'png' | 'jpeg'
  seed?: number
}

interface CellSummary {
  index: number
  char: string | null
  empty: boolean
  touchesEdge: boolean
  yMin: number | null
  yMax: number | null
}

interface ScanSummary {
  ms: number
  pageId: { version: number; pageIndex: number } | null
  idConfidence: number
  cells: CellSummary[]
}

const OUT = join(import.meta.dirname, '..', 'fixtures', 'synthetic')
const LEFT_QUOTES = ['‘', '“']

const FIXTURES: Record<string, FixtureSpec> = {
  'p1-scan': { pageIndex: 0 },
  'p2-scan-no-left-quotes': { pageIndex: 1, skip: LEFT_QUOTES },
  'p1-photo-tilt-right': { pageIndex: 0, rotate: 5, skew: 0.03, shade: 0.6, shadow: true, noise: 10, tint: true, format: 'jpeg', seed: 2 },
  'p1-photo-tilt-left': { pageIndex: 0, rotate: -5, skew: 0.025, shade: 0.75, noise: 12, tint: true, format: 'jpeg', seed: 7 },
  'p2-photo-upside-down': { pageIndex: 1, rotate: 176, skew: 0.02, shade: 0.7, shadow: true, noise: 8, tint: true, format: 'jpeg', seed: 3 },
  'p2-photo-sideways': { pageIndex: 1, rotate: 90, skew: 0.015, noise: 6, format: 'jpeg', seed: 5 },
}

// Expected filled cells per page.
const FILLED = [52, 51]

async function openHarness(page: Page) {
  await page.goto('dev/fixtures.html')
  await page.waitForFunction(() => 'hw' in window)
}

async function makeAndScan(page: Page, name: string, spec: FixtureSpec): Promise<ScanSummary> {
  const fixture = await page.evaluate((s) => window.hw.makeFixture(s), spec)
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, `${name}.${spec.format === 'jpeg' ? 'jpg' : 'png'}`), Buffer.from(fixture.base64, 'base64'))
  return page.evaluate(({ base64, type }) => window.hw.scan(base64, type), fixture) as Promise<ScanSummary>
}

const byChar = (r: ScanSummary) => new Map(r.cells.filter((c) => c.char).map((c) => [c.char!, c]))

test.describe('scan pipeline on synthetic fixtures', () => {
  // Reference baselines from the undistorted scans, to compare distorted photos against.
  const reference = new Map<number, Map<string, CellSummary>>()

  for (const [name, spec] of Object.entries(FIXTURES)) {
    test(name, async ({ page }) => {
      await openHarness(page)
      const r = await makeAndScan(page, name, spec)
      const skipped = spec.skip?.length ?? 0

      expect(r.pageId).toEqual({ version: 1, pageIndex: spec.pageIndex, ext: 0 })
      expect(r.idConfidence).toBeGreaterThan(0.25)

      const filled = r.cells.filter((c) => !c.empty)
      expect(filled.length).toBe(FILLED[spec.pageIndex] - skipped)
      expect(filled.every((c) => c.char !== null), 'ink found in an unused cell').toBe(true)
      expect(r.cells.filter((c) => c.touchesEdge).map((c) => c.char)).toEqual([])
      for (const ch of spec.skip ?? []) expect(byChar(r).get(ch)!.empty).toBe(true)

      const chars = byChar(r)
      if (spec.pageIndex === 0) {
        // Baselines line up: "x" sits on the baseline, "g" has a tail below it.
        expect(Math.abs(chars.get('x')!.yMin!)).toBeLessThan(70)
        expect(Math.abs(chars.get('x')!.yMax! - 480)).toBeLessThan(90)
        expect(chars.get('g')!.yMin!).toBeLessThan(-150)
        expect(chars.get('H')!.yMax!).toBeGreaterThan(600)
      } else {
        expect(Math.abs(chars.get('0')!.yMin!)).toBeLessThan(70)
        expect(chars.get(',')!.yMin!).toBeLessThan(0)
      }

      // Distorted photos should land within ~2 px (at 300 DPI) of the clean scan.
      const ref = reference.get(spec.pageIndex)
      if (!spec.rotate && !spec.skew) reference.set(spec.pageIndex, chars)
      else if (ref) {
        for (const [ch, c] of chars) {
          const base = ref.get(ch)
          if (!base || c.empty || base.empty) continue
          expect(Math.abs(c.yMin! - base.yMin!), `bottom of ${ch}`).toBeLessThan(25)
          expect(Math.abs(c.yMax! - base.yMax!), `top of ${ch}`).toBeLessThan(25)
        }
      }
    })
  }
})

test('upload both pages through the UI and review the glyphs', async ({ page }) => {
  await openHarness(page)
  const files = []
  for (const [name, spec] of [
    ['ui-p1', FIXTURES['p1-photo-tilt-right']],
    ['ui-p2', FIXTURES['p2-scan-no-left-quotes']],
  ] as const) {
    const fx = await page.evaluate((s) => window.hw.makeFixture(s), spec)
    files.push({ name: `${name}.${spec.format === 'jpeg' ? 'jpg' : 'png'}`, mimeType: fx.type, buffer: Buffer.from(fx.base64, 'base64') })
  }

  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles(files)
  await expect(page.getByTestId('upload-row').and(page.locator('[data-status="done"]'))).toHaveCount(2, { timeout: 60_000 })
  await expect(page.getByText('Page 1 (letters) detected')).toBeVisible()
  await expect(page.getByText('Page 2 (numbers and punctuation) detected')).toBeVisible()

  // All 103 characters are ready: the two blank left quotes fall back to the straight quotes.
  await expect(page.getByTestId('review-summary')).toHaveText('103 of 103 characters ready.')
  await expect(page.getByTestId('glyph')).toHaveCount(103)
  await expect(page.locator('[data-testid="glyph"][data-char="‘"]')).toContainText("uses '")

  // Clicking a glyph shows the original scan next to the cleaned ink.
  await page.locator('[data-testid="glyph"][data-char="g"]').click()
  const drawer = page.getByRole('dialog', { name: 'Details for g' })
  await expect(drawer).toContainText('Scan')
  await expect(drawer).toContainText('In the font')
  // The drawer opens without moving the page.
  const y = await page.evaluate(() => window.scrollY)
  await drawer.getByRole('button', { name: 'Next letter' }).click()
  await expect(page.getByRole('dialog', { name: 'Details for h' })).toBeVisible()
  expect(await page.evaluate(() => window.scrollY)).toBe(y)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Re-uploading a full page 1 replaces every character on it.
  await page.getByTestId('upload-input').setInputFiles([{ ...files[0], name: 'ui-p1-again.jpg' }])
  await expect(page.getByText('Every character has been replaced by a newer upload.')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('glyph')).toHaveCount(103)
})

declare global {
  interface Window {
    hw: {
      makeFixture(spec: FixtureSpec): Promise<{ base64: string; type: string }>
      scan(base64: string, type: string): Promise<ScanSummary>
    }
  }
}
