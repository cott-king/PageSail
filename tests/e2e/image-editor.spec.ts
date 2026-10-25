import { expect, test, type Page } from '@playwright/test';
import { decodeImage, near } from '../helpers/pdf';
import { downloadBytes, dragOnStage, fixturePath, recordNetwork, stagePoint } from './helpers';

async function exportImage(page: Page, format: 'png' | 'jpeg') {
  await page.getByTestId(`format-${format}`).check({ force: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-image').click();
  const download = await downloadPromise;
  return { name: download.suggestedFilename(), img: await decodeImage(await downloadBytes(download)) };
}

test('crop, resize, rotate, adjust and annotate; export uses the real pixel size and keeps transparency', async ({ page, baseURL }) => {
  const net = recordNetwork(page, baseURL!);
  await page.goto('/image-editor');
  // transparent.png: 200x200, left half transparent, right half blue, yellow square at (150..200, 150..200).
  await page.getByTestId('image-input').setInputFiles(fixturePath('transparent.png'));
  await expect(page.getByTestId('image-size')).toContainText('200 × 200');

  await page.getByTestId('crop-start').click();
  await page.getByTestId('crop-width').fill('120');
  await page.getByTestId('crop-height').fill('150');
  await page.getByTestId('crop-x').fill('50');
  await page.getByTestId('crop-y').fill('20');
  await page.getByTestId('crop-apply').click();
  await expect(page.getByTestId('image-size')).toContainText('120 × 150');

  await page.getByTestId('resize-width').fill('240');
  await expect(page.getByTestId('resize-height')).toHaveValue('300'); // aspect ratio kept
  await page.getByTestId('resize-apply').click();
  await expect(page.getByTestId('image-size')).toContainText('240 × 300');

  await page.getByTestId('rotate-right').click();
  await expect(page.getByTestId('image-size')).toContainText('300 × 240');

  await page.getByTestId('brightness').fill('40');
  await page.getByTestId('brightness').dispatchEvent('pointerup');

  // A filled rectangle annotation (not affected by brightness).
  await page.getByTestId('tool-rect').click();
  await page.getByTestId('fill-toggle').check();
  await dragOnStage(page, 300, [20, 20], [80, 60]);
  await expect(page.getByTestId('delete-object')).toBeVisible();

  // Final pixel (X, Y) comes from source pixel (50 + Y/2, 20 + (300 - X)/2).
  let { name, img } = await exportImage(page, 'png');
  expect(name).toBe('transparent_edited.png');
  expect([img.width, img.height]).toEqual([300, 240]);
  expect(img.pixel(150, 50)[3]).toBe(0); // transparent stays transparent
  expect(near(img.pixel(150, 150), [102, 102, 255])).toBe(true); // brightened blue
  expect(near(img.pixel(20, 220), [255, 255, 102])).toBe(true); // brightened yellow
  expect(near(img.pixel(50, 40), [229, 72, 77])).toBe(true); // annotation colour unchanged
  expect(img.pixel(50, 40)[3]).toBe(255);

  // Undo removes the rectangle from the export; redo brings it back.
  await page.getByTestId('undo').click();
  ({ img } = await exportImage(page, 'png'));
  expect(img.pixel(50, 40)[3]).toBe(0);
  await page.getByTestId('redo').click();

  // JPG: transparent areas get the chosen background colour; no alpha.
  await page.getByTestId('format-jpeg').check({ force: true });
  await page.getByTestId('jpg-background').fill('#00ff00');
  ({ name, img } = await exportImage(page, 'jpeg'));
  expect(name).toBe('transparent_edited.jpg');
  expect([img.width, img.height]).toEqual([300, 240]);
  expect(near(img.pixel(150, 50), [0, 255, 0])).toBe(true);
  expect(img.pixel(150, 50)[3]).toBe(255);
  expect(near(img.pixel(50, 40), [229, 72, 77])).toBe(true);

  // Reset returns to the original image.
  await page.getByTestId('reset').click();
  await expect(page.getByTestId('image-size')).toContainText('200 × 200');
  net.assertPrivate(['transparent.png']);
});

test('EXIF orientation, flips and added text affect the exported image', async ({ page }) => {
  await page.goto('/image-editor');
  await page.getByTestId('image-input').setInputFiles(fixturePath('exif-rotate6.jpg'));
  // Stored 160x80 with orientation 6 → shown and exported upright as 80x160.
  await expect(page.getByTestId('image-size')).toContainText('80 × 160');
  let { img } = await exportImage(page, 'png');
  expect([img.width, img.height]).toEqual([80, 160]);
  expect(near(img.pixel(70, 10), [0, 0, 0])).toBe(true);

  await page.getByTestId('flip-h').click();
  ({ img } = await exportImage(page, 'png'));
  expect(near(img.pixel(10, 10), [0, 0, 0])).toBe(true);
  expect(near(img.pixel(70, 10), [255, 136, 0])).toBe(true);

  // White CJK text on the orange image.
  await page.getByTestId('tool-text').click();
  const p = await stagePoint(page, 80, 5, 60);
  await page.mouse.click(p.x, p.y);
  const textarea = page.getByTestId('text-content');
  await expect(textarea).toBeFocused({ timeout: 60_000 });
  await textarea.fill('中');
  await page.getByTestId('font-size').fill('60');
  await textarea.focus();
  await textarea.blur();
  ({ img } = await exportImage(page, 'png'));
  let white = 0;
  for (let y = 60; y < 130; y++) for (let x = 0; x < 80; x++) if (near(img.pixel(x, y), [255, 255, 255], 30)) white++;
  expect(white).toBeGreaterThan(300);
});
