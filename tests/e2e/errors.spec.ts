import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fixturePath } from './helpers';

/** A PNG header that claims 20000 x 20000 px (400 MP); only the header is valid. */
function hugePngHeader(): Buffer {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0);
  b.writeUInt32BE(20000, 16);
  b.writeUInt32BE(20000, 20);
  b[24] = 8;
  b[25] = 6;
  return b;
}

test('PDF tools explain bad input and recover with the next file', async ({ page }) => {
  await page.goto('/pdf-to-image');
  const input = page.getByTestId('pdf-input');
  const alert = page.getByRole('alert');

  await input.setInputFiles(fixturePath('empty.pdf'));
  await expect(alert).toContainText('是空文件');

  await input.setInputFiles(fixturePath('corrupt.pdf'));
  await expect(alert).toContainText('已损坏或不是有效的 PDF');

  await input.setInputFiles(fixturePath('encrypted-password.pdf'));
  await expect(alert).toContainText('受密码保护');

  await input.setInputFiles(fixturePath('image-named.pdf'));
  await expect(alert).toContainText('是图片而不是 PDF');

  await input.setInputFiles(fixturePath('multipage.pdf'));
  await expect(page.locator('.page-card img')).toHaveCount(4);
  await expect(alert).toHaveCount(0);
});

test('viewing an owner-password (permissions-only) PDF works, editing it is refused clearly', async ({ page }) => {
  await page.goto('/pdf-to-image');
  await page.getByTestId('pdf-input').setInputFiles(fixturePath('encrypted-owner-only.pdf'));
  await expect(page.locator('.page-card img')).toHaveCount(3);

  await page.goto('/pdf-annotate');
  await page.getByTestId('pdf-input').setInputFiles(fixturePath('encrypted-owner-only.pdf'));
  await expect(page.getByRole('alert')).toContainText('无法修改加密的 PDF');
  // Recovery without reloading.
  await page.getByTestId('pdf-input').setInputFiles(fixturePath('annotate-targets.pdf'));
  await expect(page.locator('.editor-pages .page-card')).toHaveCount(6);

  await page.goto('/pdf-pages');
  await page.getByTestId('pdf-input').setInputFiles([fixturePath('encrypted-password.pdf'), fixturePath('docB.pdf')]);
  await expect(page.getByTestId('page-card')).toHaveCount(2);
  await expect(page.getByText('受密码保护')).toBeVisible();
});

test('image tools reject unsupported formats and oversized images before decoding', async ({ page }) => {
  await page.goto('/image-editor');
  const input = page.getByTestId('image-input');
  await input.setInputFiles(fixturePath('image.webp'));
  await expect(page.getByRole('alert')).toContainText('WebP');
  await input.setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: hugePngHeader() });
  await expect(page.getByRole('alert')).toContainText('20000 × 20000');
  await input.setInputFiles(fixturePath('multipage.pdf'));
  await expect(page.getByRole('alert')).toContainText('是 PDF');
  await input.setInputFiles(fixturePath('red-wide.png'));
  await expect(page.getByTestId('image-size')).toContainText('240 × 120');

  await page.goto('/image-to-pdf');
  await page.getByTestId('image-input').setInputFiles([
    { name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) },
    { name: 'huge.png', mimeType: 'image/png', buffer: hugePngHeader() },
    { name: 'green-tall.jpg', mimeType: 'image/jpeg', buffer: readFileSync(fixturePath('green-tall.jpg')) },
  ]);
  await expect(page.getByTestId('image-item')).toHaveCount(1);
  await expect(page.getByText('是空文件')).toBeVisible();
  await expect(page.getByText(/20000 × 20000/)).toBeVisible();
});
