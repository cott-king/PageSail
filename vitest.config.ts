import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __PDFJS_ASSET_DIR__: JSON.stringify('vendor/pdfjs-test'),
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // pdf-lib and pdf.js are CPU heavy; keep parallelism modest so CI boxes and a Raspberry Pi cope.
    maxWorkers: 2,
  },
});
