// End-to-end: step 1's basic template (letters + common ligatures) and the
// gear menu's "A PDF per page" option, which downloads a .zip of one-page PDFs.
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { readStoredZip } from '../unit/helpers/readZip'

test('basic template downloads as one PDF, or as a zip with a PDF per page', async ({ page }) => {
  await page.goto('./')

  // Default: one PDF with both letters pages and the common-ligatures sheet.
  const [single] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()])
  expect(single.suggestedFilename()).toMatch(/^handwriting-template-v\d+-letter\.pdf$/)
  const pdf = await PDFDocument.load(readFileSync(await single.path()))
  expect(pdf.getPageCount()).toBe(3)

  // Switch to a PDF per page in the gear menu.
  await page.getByRole('button', { name: 'Download options' }).click()
  await page.getByLabel('A PDF per page').check()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('A PDF per page')).toHaveCount(0)

  const [zipped] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download 3 PDFs (.zip)' }).click()])
  expect(zipped.suggestedFilename()).toMatch(/^handwriting-template-v\d+-letter\.zip$/)
  const entries = readStoredZip(new Uint8Array(readFileSync(await zipped.path())))
  expect(entries.map((e) => e.name.replace(/-v\d+-/, '-'))).toEqual([
    'handwriting-template-letter-page-1.pdf',
    'handwriting-template-letter-page-2.pdf',
    'handwriting-template-letter-page-3.pdf',
  ])
  for (const e of entries) expect((await PDFDocument.load(e.data)).getPageCount()).toBe(1)

  // The choice is remembered after a reload.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Download 3 PDFs (.zip)' })).toBeVisible()
})

test('a style choice applies to the basic template and the blank ligature sheets', async ({ page }) => {
  await page.goto('./')
  await page.getByLabel('Style').selectOption('bold')
  await expect(page.getByRole('heading', { name: 'Basic template, Bold' })).toBeVisible()
  await page.getByText('More sheets').click()
  const [blank] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  ])
  expect(blank.suggestedFilename()).toMatch(/^handwriting-ligatures-bold-blank-1-v\d+-letter\.pdf$/)
})
