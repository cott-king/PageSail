import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Builds dist/licenses/THIRD_PARTY_NOTICES.txt from the packages that actually end up in
 * the production bundles (main app + Web Workers), plus the runtime data files we ship
 * (pdf.js CMaps/fonts/wasm, Noto fonts). The build fails if a bundled package is missing
 * from the human-readable summary in THIRD_PARTY_NOTICES.md, so the two cannot drift.
 */

const bundledPackageDirs = new Set<string>();

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|mit|bsd|apache2))?$/i;

function packageRoot(id: string): string | null {
  const clean = id.replace(/^\0/, '').split('?')[0];
  const m = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(clean);
  return m ? m[1] : null;
}

/** Records node_modules packages that are part of a bundle. Add to both `plugins` and `worker.plugins`. */
export function trackBundledPackages(): Plugin {
  return {
    name: 'pagesail:track-bundled-packages',
    apply: 'build',
    generateBundle(_opts, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of chunk.moduleIds) {
          const root = packageRoot(id);
          if (root) bundledPackageDirs.add(root);
        }
      }
    },
  };
}

/**
 * Some packages declare a license in package.json but ship no license file. We state
 * the declared license and point to the upstream project instead of inventing a copyright line.
 */
const MISSING_FILE_NOTES: Record<string, string> = {
  '@pdf-lib/fontkit':
    'The npm package declares "MIT" in package.json but ships no license file.\n' +
    'It is a fork of fontkit (https://github.com/foliojs/fontkit, MIT License); see the\n' +
    'fork at https://github.com/Hopding/fontkit for its copyright notice. Its prebuilt\n' +
    'bundle also includes small MIT-licensed helpers (e.g. restructure, unicode-properties,\n' +
    'unicode-trie, tiny-inflate, brotli decoder, base64-js, ieee754, buffer, clone, deep-equal, dfa).',
};

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

interface ExtraFile {
  title: string;
  file: string;
}

export function licenseNotices(opts: { root: string; pdfjsDir: string; extraFiles: ExtraFile[] }): Plugin {
  return {
    name: 'pagesail:license-notices',
    apply: 'build',
    enforce: 'post',
    generateBundle(_o, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of chunk.moduleIds) {
          const r = packageRoot(id);
          if (r) bundledPackageDirs.add(r);
        }
      }
      const summary = readFileSync(path.join(opts.root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
      const pkgs = [...bundledPackageDirs]
        .map((dir) => {
          const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
          return { dir, name: pkg.name as string, version: pkg.version as string, license: (pkg.license ?? pkg.licenses ?? 'UNKNOWN') as string, homepage: (pkg.homepage ?? pkg.repository?.url ?? pkg.repository ?? '') as string };
        })
        .filter((p, i, all) => all.findIndex((q) => q.name === p.name && q.version === p.version) === i)
        .sort((a, b) => a.name.localeCompare(b.name));

      const missing = pkgs.filter((p) => !summary.includes(`\`${p.name}\``));
      if (missing.length) {
        this.error(`THIRD_PARTY_NOTICES.md does not list bundled package(s): ${missing.map((p) => p.name).join(', ')}`);
      }

      const out: string[] = [];
      out.push('PageSail — third-party notices');
      out.push('================================');
      out.push('');
      out.push('PageSail itself is licensed under the MIT License (see LICENSE in the source');
      out.push('repository). The components below are distributed with this site under their');
      out.push('own licenses; they are not relicensed under MIT.');
      out.push('');
      out.push(`Bundled JavaScript packages (${pkgs.length}):`);
      for (const p of pkgs) out.push(`  - ${p.name}@${p.version} (${p.license})`);
      for (const p of pkgs) {
        out.push('', '-'.repeat(78), `${p.name}@${p.version}`, `License: ${p.license}`);
        if (p.homepage) out.push(`Source: ${String(p.homepage).replace(/^git\+/, '')}`);
        out.push('');
        const files = readdirSync(p.dir).filter((f) => LICENSE_FILE.test(f));
        if (files.length) {
          for (const f of files) out.push(readFileSync(path.join(p.dir, f), 'utf8').trim(), '');
        } else if (MISSING_FILE_NOTES[p.name]) {
          out.push(MISSING_FILE_NOTES[p.name], '', /MIT/.test(p.license) ? MIT_TEXT : '');
        } else {
          this.error(`No license file found for bundled package ${p.name}; add a note in scripts/vite-licenses.ts`);
        }
      }
      for (const extra of opts.extraFiles) {
        const file = path.isAbsolute(extra.file) ? extra.file : path.join(opts.root, extra.file);
        if (!existsSync(file)) this.error(`Missing license file ${file}`);
        out.push('', '-'.repeat(78), extra.title, '', readFileSync(file, 'utf8').trim(), '');
      }
      this.emitFile({ type: 'asset', fileName: 'licenses/THIRD_PARTY_NOTICES.txt', source: out.join('\n') + '\n' });
    },
  };
}
