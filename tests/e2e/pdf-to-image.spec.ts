import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { decodeImage, near } from '../helpers/pdf';
import { downloadBytes, fixturePath, recordNetwork } from './helpers';

test.describe('PDF → PNG/JPG', () => {
  test('exports a page range as PNGs in a ZIP with correct order, orientation and size', async ({ page, baseURL }) => {
    const net = recordNetwork(page, baseURL!);
    await page.goto('/pdf-to-image');
    await page.getByTestId('pdf-input').setInputFiles(fixturePath('multipage.pdf'));
    await expect(page.locator('.page-card')).toHaveCount(4);
    await expect(page.locator('.page-card img')).toHaveCount(4);

    await page.getByTestId('page-range').fill('1,3-4');
    await page.getByTestId('dpi').selectOption('72');
    await expect(page.getByTestId('estimate')).toContainText('595 × 842');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('convert').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('multipage_png.zip');

    const files = unzipSync(await downloadBytes(download));
    expect(Object.keys(files)).toEqual(['multipage_page-1.png', 'multipage_page-3.png', 'multipage_page-4.png']);

    // Page 1: A4 portrait, red marker at the top-left.
    const p1 = await decodeImage(files['multipage_page-1.png']);
    expect([p1.width, p1.height]).toEqual([595, 842]);
    expect(near(p1.pixel(20, 20), [255, 0, 0])).toBe(true);
    expect(near(p1.pixel(575, 20), [255, 255, 255])).toBe(true);

    // Page 3 has /Rotate 90: output is landscape and the marker appears top-right.
    const p3 = await decodeImage(files['multipage_page-3.png']);
    expect([p3.width, p3.height]).toEqual([842, 595]);
    expect(near(p3.pixel(822, 20), [0, 0, 255])).toBe(true);
    expect(near(p3.pixel(20, 20), [255, 255, 255])).toBe(true);

    // Page 4 is cropped to 400x500; the orange band outside the CropBox must not appear.
    const p4 = await decodeImage(files['multipage_page-4.png']);
    expect([p4.width, p4.height]).toEqual([400, 500]);
    expect(near(p4.pixel(20, 20), [255, 0, 255])).toBe(true);
    for (const y of [100, 250, 480]) expect(near(p4.pixel(3, y), [255, 255, 255])).toBe(true);

    net.assertPrivate(['multipage.pdf']);
  });

  test('exports a single page as JPG at the chosen DPI', async ({ page }) => {
    await page.goto('/pdf-to-image');
    await page.getByTestId('pdf-input').setInputFiles(fixturePath('multipage.pdf'));
    await page.getByTestId('page-range').fill('2');
    await page.getByText('JPG', { exact: true }).click();
    await page.getByTestId('dpi').selectOption('150');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('convert').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('multipage_page-2.jpg');
    const bytes = await downloadBytes(download);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
    const img = await decodeImage(bytes);
    // 842 x 595 pt at 150 DPI
    expect([img.width, img.height]).toEqual([Math.round((842 * 150) / 72), Math.round((595 * 150) / 72)]);
    expect(near(img.pixel(30, 30), [0, 204, 0])).toBe(true);
  });

  test('validates the page range and can be cancelled without producing a file', async ({ page }) => {
    await page.goto('/pdf-to-image');
    await page.getByTestId('pdf-input').setInputFiles(fixturePath('multipage.pdf'));
    await page.getByTestId('page-range').fill('2-9');
    await expect(page.locator('#range-help')).toHaveClass(/field-error/);
    await expect(page.getByTestId('convert')).toBeDisabled();

    await page.getByTestId('page-range').fill('');
    await page.getByTestId('dpi').selectOption('600');
    let downloaded = false;
    page.on('download', () => (downloaded = true));
    await page.getByTestId('convert').click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByText('已取消，没有生成文件。')).toBeVisible();
    await page.waitForTimeout(1500);
    expect(downloaded).toBe(false);
  });
});
