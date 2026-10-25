import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { near, openPdf, renderPage } from '../helpers/pdf';
import { downloadBytes, fixturePath, recordNetwork } from './helpers';

test('images → PDF: reorder, layout options, real page order and content', async ({ page, baseURL }) => {
  const net = recordNetwork(page, baseURL!);
  await page.goto('/image-to-pdf');
  await page.getByTestId('image-input').setInputFiles([fixturePath('red-wide.png'), fixturePath('exif-rotate6.jpg'), fixturePath('image.webp')]);
  await expect(page.getByTestId('image-item')).toHaveCount(2);
  // The unsupported WebP is listed with an explanation, the rest is accepted.
  await expect(page.getByText('image.webp', { exact: true })).toBeVisible();
  await expect(page.getByText(/WebP/).first()).toBeVisible();
  // Add more later; then move the PNG with transparency to the front.
  await page.getByTestId('image-input').setInputFiles([fixturePath('transparent.png')]);
  await expect(page.getByTestId('image-item')).toHaveCount(3);
  await page.getByRole('button', { name: '将 transparent.png 前移' }).click();
  await page.getByRole('button', { name: '将 transparent.png 前移' }).click();
  await expect(page.getByTestId('image-item').first()).toHaveAttribute('data-name', 'transparent.png');

  await page.getByTestId('page-size').selectOption('fit');
  await page.getByTestId('margin').fill('0');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('build-pdf').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('images.pdf');
  const bytes = await downloadBytes(download);
  net.assertPrivate(['red-wide.png', 'exif-rotate6.jpg', 'transparent.png']);

  const lib = await PDFDocument.load(bytes);
  expect(lib.getPageCount()).toBe(3);
  expect(lib.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])).toEqual([
    [150, 150],
    [180, 90],
    [60, 120],
  ]);
  const doc = await openPdf(bytes);
  let r = await renderPage(doc, 1, 4 / 3);
  expect(near(r.avg(150, 50), [0, 0, 255])).toBe(true);
  expect(near(r.avg(40, 100), [255, 255, 255])).toBe(true); // transparent area on white paper
  r = await renderPage(doc, 2, 4 / 3);
  expect(near(r.avg(10, 10), [0, 0, 0])).toBe(true);
  expect(near(r.avg(120, 60), [255, 0, 0])).toBe(true);
  r = await renderPage(doc, 3, 4 / 3);
  expect(near(r.avg(70, 10), [0, 0, 0])).toBe(true); // EXIF orientation applied
});

test('images → PDF: A4 landscape with margins keeps proportions', async ({ page }) => {
  await page.goto('/image-to-pdf');
  await page.getByTestId('image-input').setInputFiles([fixturePath('green-tall.jpg')]);
  await expect(page.getByTestId('image-item')).toHaveCount(1);
  await page.getByText('横向', { exact: true }).click();
  await page.getByTestId('margin').fill('20');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('build-pdf').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('green-tall.pdf');
  const doc = await openPdf(await downloadBytes(download));
  const r = await renderPage(doc, 1, 1);
  expect([r.width, r.height]).toEqual([842, 595]);
  // Content height = 595.28 - 2*56.69 = 481.9; image 120x240 → 240.95 x 481.9, centred.
  const h = 595.28 - 2 * ((20 * 72) / 25.4);
  const w = h / 2;
  const left = (841.89 - w) / 2;
  const top = (595.28 - h) / 2;
  expect(near(r.avg(left + 5, top + 5, 1), [0, 0, 0])).toBe(true);
  expect(near(r.avg(left + w / 2, top + h - 5, 1), [0, 192, 0])).toBe(true);
  expect(near(r.avg(left - 6, top + h / 2, 1), [255, 255, 255])).toBe(true);
  expect(near(r.avg(left + w + 6, top + h / 2, 1), [255, 255, 255])).toBe(true);
});
