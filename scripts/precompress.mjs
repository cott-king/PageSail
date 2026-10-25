// Pre-compresses text-like build output with gzip (level 9) so Nginx can serve the
// .gz files directly (gzip_static) instead of compressing on every request.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = path.resolve(process.argv[2] ?? 'dist');
const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|txt|ttf|wasm|bcmap|pfb|icc|map)$/i;
let count = 0;
let saved = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    const st = statSync(file);
    if (st.isDirectory()) walk(file);
    else if (COMPRESSIBLE.test(name) && st.size >= 1024) {
      const data = readFileSync(file);
      const gz = gzipSync(data, { level: 9 });
      if (gz.length < data.length * 0.9) {
        writeFileSync(`${file}.gz`, gz);
        count++;
        saved += data.length - gz.length;
      }
    }
  }
}

walk(dist);
console.log(`precompress: wrote ${count} .gz files, saving ${(saved / 1024 / 1024).toFixed(1)} MB per full download`);
