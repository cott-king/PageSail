import { expect, test } from '@playwright/test';
import { decodeImage } from '../helpers/pdf';
import { downloadBytes, fixturePath } from './helpers';

test('mobile: choose a PDF, preview pages and download an image', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tool-pdf-to-image').click();
  await page.getByTestId('pdf-input').setInputFiles(fixturePath('multipage.pdf'));
  await expect(page.locator('.page-card img')).toHaveCount(4);
  await page.getByTestId('page-range').fill('1');
  await page.getByTestId('dpi').selectOption('72');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('convert').click();
  const img = await decodeImage(await downloadBytes(await downloadPromise));
  expect([img.width, img.height]).toEqual([595, 842]);
  // No horizontal page scrolling on a phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('mobile: the image editor opens, edits and exports', async ({ page }) => {
  await page.goto('/image-editor');
  await page.getByTestId('image-input').setInputFiles(fixturePath('red-wide.png'));
  await expect(page.getByTestId('image-size')).toContainText('240 × 120');
  await page.getByTestId('rotate-left').click();
  await expect(page.getByTestId('image-size')).toContainText('120 × 240');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-image').click();
  const img = await decodeImage(await downloadBytes(await downloadPromise));
  expect([img.width, img.height]).toEqual([120, 240]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
