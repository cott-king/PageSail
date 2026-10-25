import { expect, test, type Page } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { apply } from '../../src/lib/affine';
import { pdfToDisplayMatrix, type PageGeometry } from '../../src/lib/pdf/coords';
import { near, openPdf, pageText, renderPage, textItems } from '../helpers/pdf';
import { downloadBytes, dragOnStage, fixturePath, recordNetwork, stagePoint } from './helpers';

/** Display widths of the pages in annotate-targets.pdf (rotations 0/90/180/270, cropped+rotated, unbalanced CTM). */
const WIDTH = [595, 842, 595, 842, 600, 595];

async function goToPage(page: Page, n: number) {
  await page.getByTestId('page-number').fill(String(n));
  await expect(page.getByTestId('stage')).toHaveAttribute('data-page', String(n));
  await expect(page.getByTestId('stage')).toHaveAttribute('data-display-width', String(WIDTH[n - 1]));
}

async function drawFilledRect(page: Page, n: number, from: [number, number], to: [number, number]) {
  await page.getByTestId('tool-rect').click();
  if (!(await page.getByTestId('fill-toggle').isChecked())) await page.getByTestId('fill-toggle').check();
  await dragOnStage(page, WIDTH[n - 1], from, to);
  await expect(page.getByTestId('delete-object')).toBeVisible(); // the new shape is selected
}

async function openEditor(page: Page) {
  await page.goto('/pdf-annotate');
  await page.getByTestId('pdf-input').setInputFiles(fixturePath('annotate-targets.pdf'));
  await expect(page.getByTestId('stage').locator('canvas').first()).toBeVisible();
  await expect(page.locator('.editor-pages .page-card')).toHaveCount(6);
}

async function geometry(bytes: Uint8Array, n: number): Promise<PageGeometry> {
  const doc = await openPdf(bytes);
  const p = await doc.getPage(n);
  return { view: p.view as PageGeometry['view'], rotate: p.rotate, userUnit: p.userUnit };
}

const SHAPE = [229, 72, 77]; // default colour #e5484d

test.describe('PDF annotation editor', () => {
  test('adds shapes and CJK text on rotated/cropped pages; export matches the preview', async ({ page, baseURL }) => {
    const net = recordNetwork(page, baseURL!);
    await openEditor(page);

    // Page 1: a filled rectangle and Chinese/English/Japanese text typed through the textarea.
    await drawFilledRect(page, 1, [100, 100], [200, 150]);
    await page.getByTestId('tool-text').click();
    const at = await stagePoint(page, WIDTH[0], 100, 300);
    await page.mouse.click(at.x, at.y);
    const textarea = page.getByTestId('text-content');
    await expect(textarea).toBeFocused({ timeout: 60_000 }); // font download happens first
    await textarea.fill('你好 Hello こんにちは');
    await textarea.blur();
    // Add an EXIF-rotated photo; it is placed in the page centre at its displayed orientation.
    await page.getByTestId('annot-image-input').setInputFiles(fixturePath('exif-rotate6.jpg'));
    await expect(page.getByTestId('delete-object')).toBeVisible();

    // Page 2 (/Rotate 90): one rectangle, plus one that we undo, redo and undo again.
    await goToPage(page, 2);
    await drawFilledRect(page, 2, [300, 200], [400, 260]);
    await drawFilledRect(page, 2, [600, 400], [700, 500]);
    await page.getByTestId('undo').click();
    await page.getByTestId('redo').click();
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('redo')).toBeEnabled();

    // Page 5 (CropBox offset + /Rotate 90) and page 6 (content leaves a modified CTM).
    await goToPage(page, 5);
    await drawFilledRect(page, 5, [50, 60], [150, 120]);
    await goToPage(page, 6);
    await drawFilledRect(page, 6, [200, 500], [260, 540]);

    // Going back to page 1 shows its objects again (per-page state is kept).
    await goToPage(page, 1);
    const onRect = await stagePoint(page, WIDTH[0], 150, 125);
    await page.mouse.click(onRect.x, onRect.y);
    await expect(page.getByTestId('delete-object')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-pdf').click();
    const bytes = await downloadBytes(await downloadPromise);
    net.assertPrivate(['annotate-targets.pdf', 'exif-rotate6.jpg']);

    const doc = await openPdf(bytes);
    expect(doc.numPages).toBe(6);
    const r1 = await renderPage(doc, 1, 1);
    expect(near(r1.avg(150, 125), SHAPE)).toBe(true);
    expect(near(r1.avg(104, 104, 1), SHAPE)).toBe(true);
    expect(near(r1.avg(196, 146, 1), SHAPE)).toBe(true);
    expect(near(r1.avg(150, 160, 1), [255, 255, 255])).toBe(true);
    // Image (80x160 displayed) centred on the page; its marker is at the displayed top-right.
    expect(near(r1.avg(322, 356, 3), [0, 0, 0])).toBe(true);
    expect(near(r1.avg(270, 480, 3), [255, 136, 0])).toBe(true);

    // Text is real text, in the right font, at the clicked position (baseline below the top).
    expect(await pageText(doc, 1)).toContain('你好 Hello こんにちは');
    expect(await pageText(doc, 1)).toContain('Original text rotate 0');
    const item = (await textItems(doc, 1)).find((t) => t.str.includes('你好'))!;
    const [bx, by] = apply(pdfToDisplayMatrix(await geometry(bytes, 1)), item.transform[4], item.transform[5]);
    expect(Math.abs(bx - 100)).toBeLessThan(1.5);
    expect(by).toBeGreaterThan(305);
    expect(by).toBeLessThan(320);

    const r2 = await renderPage(doc, 2, 1);
    expect(near(r2.avg(350, 230), SHAPE)).toBe(true);
    expect(near(r2.avg(650, 450), [255, 255, 255])).toBe(true); // undone rectangle is gone
    const r5 = await renderPage(doc, 5, 1);
    expect([r5.width, r5.height]).toEqual([600, 400]);
    expect(near(r5.avg(100, 90), SHAPE)).toBe(true);
    expect(near(r5.avg(100, 130, 1), [255, 255, 255])).toBe(true);
    const r6 = await renderPage(doc, 6, 1);
    expect(near(r6.avg(230, 520), SHAPE)).toBe(true);

    // The font is embedded as a subset (not the 10 MB original).
    const lib = await PDFDocument.load(bytes);
    const fontNames = [...lib.context.enumerateIndirectObjects()]
      .map(([, o]) => o)
      .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('FontDescriptor'))
      .map((d) => String(d.get(PDFName.of('FontName'))));
    expect(fontNames.some((n) => /^\/[A-Z]{6}\+NotoSansSC-Regular$/.test(n))).toBe(true);
    expect(bytes.length).toBeLessThan(400_000);
  });

  test('blocks export when the chosen font lacks characters, and offers a fix', async ({ page }) => {
    await openEditor(page);
    await page.getByTestId('tool-text').click();
    const at = await stagePoint(page, WIDTH[0], 80, 200);
    await page.mouse.click(at.x, at.y);
    const textarea = page.getByTestId('text-content');
    await expect(textarea).toBeFocused({ timeout: 60_000 });
    await textarea.fill('Latin 中文');
    await page.getByTestId('font-select').selectOption('noto-sans');
    await expect(page.getByTestId('font-issue')).toContainText('中');
    await page.getByTestId('export-pdf').click();
    await expect(page.getByTestId('missing-glyphs')).toContainText('中 文');
    // Select the text again; one click switches to a font that covers it, then export works.
    await page.getByTestId('tool-select').click();
    const p = await stagePoint(page, WIDTH[0], 90, 208);
    await page.mouse.click(p.x, p.y);
    await page.getByTestId('font-issue').getByRole('button').click();
    await expect(page.getByTestId('font-issue')).toHaveCount(0);
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-pdf').click();
    const doc = await openPdf(await downloadBytes(await downloadPromise));
    expect(await pageText(doc, 1)).toContain('Latin 中文');
  });

  test('warns before leaving with unsaved changes', async ({ page }) => {
    await openEditor(page);
    await drawFilledRect(page, 1, [100, 100], [200, 200]);
    let message = '';
    page.once('dialog', (d) => {
      message = d.message();
      void d.dismiss();
    });
    await page.getByRole('link', { name: '全部工具' }).click();
    expect(message).toContain('尚未下载');
    await expect(page).toHaveURL(/pdf-annotate/);
    // Keyboard delete + undo work on the canvas.
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('delete-object')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('undo')).toBeEnabled();
  });
});
