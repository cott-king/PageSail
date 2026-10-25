import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { openPdf, pageText } from '../helpers/pdf';
import { downloadBytes, fixturePath, recordNetwork } from './helpers';

async function texts(bytes: Uint8Array): Promise<string[]> {
  const doc = await openPdf(bytes);
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await pageText(doc, i)).trim().slice(0, 12));
  return out;
}

const card = (page: Page, source: string, n: number) => page.locator(`[data-testid=page-card][data-source=${source}][data-page="${n}"] button`);

test('merge, delete, rotate and reorder are reflected in the exported PDF', async ({ page, baseURL }) => {
  const net = recordNetwork(page, baseURL!);
  await page.goto('/pdf-pages');
  await page.getByTestId('pdf-input').setInputFiles([fixturePath('docA.pdf'), fixturePath('docB.pdf')]);
  await expect(page.getByTestId('page-card')).toHaveCount(5);
  // Nothing edited yet: undo is unavailable.
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled();

  // Delete A3.
  await card(page, 'A', 3).click();
  await page.getByTestId('delete-pages').click();
  await expect(page.getByTestId('page-card')).toHaveCount(4);
  // Rotate B1 right; move it to the front with the keyboard-accessible "move earlier" button.
  await card(page, 'B', 1).click();
  await page.getByTestId('rotate-right').click();
  await page.getByTestId('move-earlier').click();
  await page.getByTestId('move-earlier').click();
  await expect(page.getByTestId('page-card').first()).toHaveAttribute('data-source', 'B');
  await expect(page.getByTestId('page-card').first()).toHaveAttribute('data-rotation', '90');

  // Undo/redo of the last move.
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByTestId('page-card').nth(1)).toHaveAttribute('data-source', 'B');
  await page.getByRole('button', { name: '重做' }).click();
  await expect(page.getByTestId('page-card').first()).toHaveAttribute('data-source', 'B');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('save-all').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('merged.pdf');
  const bytes = await downloadBytes(download);
  expect(await texts(bytes)).toEqual(['DOC B PAGE 1', 'DOC A PAGE 1', 'DOC A PAGE 2', 'DOC B PAGE 2']);
  const lib = await PDFDocument.load(bytes);
  expect(lib.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 0, 180]);
  expect((await texts(bytes)).join(' ')).not.toContain('SECRET');

  // The result can be previewed from the generated file.
  await page.getByRole('button', { name: '预览' }).click();
  await expect(page.getByTestId('result-preview').locator('img')).toHaveCount(4);
  await page.getByRole('button', { name: '关闭' }).click();
  net.assertPrivate(['docA.pdf', 'docB.pdf']);
});

test('extract selected pages and split into a ZIP', async ({ page }) => {
  await page.goto('/pdf-pages');
  await page.getByTestId('pdf-input').setInputFiles([fixturePath('docA.pdf')]);
  await expect(page.getByTestId('page-card')).toHaveCount(3);
  await card(page, 'A', 3).click();
  await card(page, 'A', 1).click();
  let downloadPromise = page.waitForEvent('download');
  await page.getByTestId('extract').click();
  let download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('docA_extract.pdf');
  // Extraction keeps the on-screen order (A1 before A3), not the click order.
  expect(await texts(await downloadBytes(download))).toEqual(['DOC A PAGE 1', 'DOC A PAGE 3']);

  await page.getByText('自定义范围').click();
  await page.getByTestId('split-ranges').fill('1-2, 3');
  downloadPromise = page.waitForEvent('download');
  await page.getByTestId('split').click();
  download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('docA_split.zip');
  const files = unzipSync(await downloadBytes(download));
  expect(Object.keys(files)).toEqual(['docA_part-1.pdf', 'docA_part-2.pdf']);
  expect(await texts(files['docA_part-1.pdf'])).toEqual(['DOC A PAGE 1', 'DOC A PAGE 2']);
  expect(await texts(files['docA_part-2.pdf'])).toEqual(['DOC A PAGE 3']);
});
