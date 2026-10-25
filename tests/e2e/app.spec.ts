import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ROOT } from '../helpers/pdf';
import { fixturePath, recordNetwork } from './helpers';

const pdfjsVersion = JSON.parse(readFileSync(path.join(ROOT, 'node_modules/pdfjs-dist/package.json'), 'utf8')).version;
const vendor = `/vendor/pdfjs-${pdfjsVersion}`;

test('home lists only the implemented tools and defaults to Simplified Chinese', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PageSail');
  await expect(page.getByText('我受够了只是想转换或编辑一个 PDF')).toBeVisible();
  const tools = page.locator('[data-testid^=tool-]');
  await expect(tools).toHaveCount(5);
  for (const id of ['pdf-to-image', 'image-to-pdf', 'pdf-pages', 'pdf-annotate', 'image-editor']) {
    await expect(page.getByTestId(`tool-${id}`)).toBeVisible();
  }
  await expect(page.getByText(/OCR|Word|Excel/)).toHaveCount(0);
});

test('language choice is applied everywhere and remembered', async ({ page }) => {
  await page.goto('/pdf-to-image');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PDF 转 PNG / JPG');
  await page.getByRole('combobox', { name: '语言' }).selectOption('en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PDF to PNG / JPG');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PDF to PNG / JPG');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('ja');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PDF を PNG / JPG に変換');
  await page.getByTestId('pdf-input').setInputFiles(fixturePath('empty.pdf'));
  await expect(page.getByRole('alert')).toContainText('空のファイル');
});

test('production build serves the pdf.js worker, CMaps, wasm, fonts and notices from this site', async ({ page, request, baseURL }) => {
  const net = recordNetwork(page, baseURL!);
  const responses: { url: string; status: number; type: string }[] = [];
  page.on('response', (r) => responses.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] ?? '' }));

  // A PDF with a non-embedded CJK font only decodes when the CMap files are reachable.
  await page.goto('/pdf-to-image');
  await page.getByTestId('pdf-input').setInputFiles(fixturePath('cjk-cmap.pdf'));
  await expect(page.locator('.page-card img')).toHaveCount(1);
  await expect.poll(() => responses.some((r) => r.url.includes(`${vendor}/cmaps/UniGB-UCS2-H.bcmap`) && r.status === 200)).toBe(true);
  const worker = responses.find((r) => /pdf\.worker\.min-[\w-]+\.mjs$/.test(r.url));
  expect(worker?.status).toBe(200);
  expect(worker?.type).toMatch(/javascript/);

  for (const [p, type] of [
    [`${vendor}/wasm/openjpeg.wasm`, /application\/wasm/],
    [`${vendor}/wasm/qcms_bg.wasm`, /application\/wasm/],
    // Binary data files: any (or no) content type is fine for pdf.js, which fetches them as bytes.
    [`${vendor}/standard_fonts/FoxitSerif.pfb`, /^.*$/],
    [`${vendor}/cmaps/Adobe-Japan1-UCS2.bcmap`, /^.*$/],
    [`${vendor}/iccs/CGATS001Compat-v2-micro.icc`, /^.*$/],
    ['/fonts/NotoSansSC-Regular.ttf', /font\/ttf|application\/(x-)?font|octet-stream/],
    ['/fonts/NotoSansJP-Regular.ttf', /font\/ttf|application\/(x-)?font|octet-stream/],
    ['/fonts/NotoSans-Regular.ttf', /font\/ttf|application\/(x-)?font|octet-stream/],
  ] as const) {
    const res = await request.get(p);
    expect(res.status(), p).toBe(200);
    expect((await res.body()).length, p).toBeGreaterThan(100);
    expect(res.headers()['content-type'] ?? '', p).toMatch(type);
  }
  // PDF scripting support is intentionally not shipped.
  const quickjs = await request.get(`${vendor}/wasm/quickjs-eval.wasm`);
  expect(quickjs.headers()['content-type'] ?? '').not.toMatch(/wasm/);

  const notices = await request.get('/licenses/THIRD_PARTY_NOTICES.txt');
  expect(notices.status()).toBe(200);
  const text = await notices.text();
  for (const name of ['pdfjs-dist@', 'pdf-lib@', 'fabric@', 'react@', 'fflate@', 'SIL OPEN FONT LICENSE', 'Apache License']) expect(text).toContain(name);

  net.assertPrivate(['cjk-cmap.pdf']);
});

test('deep links and refresh work (SPA fallback), unknown paths show a helpful page', async ({ page }) => {
  await page.goto('/pdf-pages');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PDF 页面管理');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PDF 页面管理');
  await page.goto('/does-not-exist');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('页面不存在');
  await page.getByRole('link', { name: '全部工具' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('security headers are sent by the production server', async ({ request }) => {
  test.skip(!process.env.PAGESAIL_EXPECT_HEADERS, 'Only the Nginx deployment sets security headers (set PAGESAIL_EXPECT_HEADERS=1).');
  const res = await request.get('/');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("connect-src 'self'");
  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['cache-control']).toContain('no-cache');
  const post = await request.post('/', { data: 'x' });
  expect(post.status()).toBe(405);
});
