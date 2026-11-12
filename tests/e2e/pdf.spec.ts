// End-to-end: a multi-page PDF scan is split into pages and each page is read.
import { expect, test, type Page } from '@playwright/test'
import { PDFDocument, PageSizes } from 'pdf-lib'

type Hw = { makeFixture(s: unknown): Promise<{ base64: string; type: string }> }

async function fixture(page: Page, spec: Record<string, unknown>) {
  const fx = await page.evaluate((s) => (window as unknown as { hw: Hw }).hw.makeFixture(s), spec)
  return Buffer.from(fx.base64, 'base64')
}

const row = (page: Page, name: string) => page.getByTestId('upload-row').filter({ hasText: name })

test('a two-page PDF scan uploads as two pages', async ({ page }) => {
  await page.goto('dev/fixtures.html')
  await page.waitForFunction(() => 'hw' in window)
  const pngs = [await fixture(page, { pageIndex: 0 }), await fixture(page, { pageIndex: 1 })]

  // Like a flatbed scanner's PDF: one full-page image per Letter page.
  const pdf = await PDFDocument.create()
  for (const png of pngs) {
    const img = await pdf.embedPng(png)
    const [w, h] = PageSizes.Letter
    pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h })
  }
  const bytes = Buffer.from(await pdf.save())

  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles([{ name: 'scans.pdf', mimeType: 'application/pdf', buffer: bytes }])
  await expect(row(page, 'scans.pdf, page 1')).toHaveAttribute('data-status', 'done', { timeout: 60_000 })
  await expect(row(page, 'scans.pdf, page 2')).toHaveAttribute('data-status', 'done', { timeout: 60_000 })
  await expect(row(page, 'scans.pdf, page 1')).toContainText('Supplies 52 characters')
  await expect(row(page, 'scans.pdf, page 2')).toContainText('Supplies 51 characters')
  await expect(page.getByTestId('pdf-opening')).toHaveCount(0)
})

test('a broken PDF shows an error', async ({ page }) => {
  await page.goto('./')
  await page.getByTestId('upload-input').setInputFiles([{ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') }])
  await expect(page.getByRole('alert')).toContainText("broken.pdf: couldn't open this PDF")
  await expect(page.getByTestId('upload-row')).toHaveCount(0)
})
