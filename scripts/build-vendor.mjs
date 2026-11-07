import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = join(root, 'vendor');
await mkdir(vendor, { recursive: true });

await build({
  entryPoints: [join(vendor, 'entry.mjs')],
  outfile: join(vendor, 'books.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  alias: { 'fs/promises': join(vendor, 'fs-stub.mjs') },
  legalComments: 'none',
  logLevel: 'info',
});

// Tauri 的 JS API 也打成单个本地 ESM 文件，桌面窗口运行时同样不需要 node_modules。
await build({
  entryPoints: [join(vendor, 'tauri-entry.mjs')],
  outfile: join(vendor, 'tauri.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'none',
  logLevel: 'info',
});

await copyFile(
  join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs'),
  join(vendor, 'pdf.worker.mjs'),
);

const licenses = join(vendor, 'licenses');
await mkdir(licenses, { recursive: true });
for (const [from, to] of [
  ['jszip/LICENSE.markdown', 'JSZip.txt'],
  ['pdfjs-dist/LICENSE', 'pdf.js.txt'],
  ['chmlib-ts/COPYING', 'chmlib-ts.txt'],
  ['@tauri-apps/api/LICENSE-MIT', 'tauri-MIT.txt'],
  ['@tauri-apps/api/LICENSE-APACHE-2.0', 'tauri-APACHE-2.0.txt'],
]) {
  await copyFile(join(root, 'node_modules', from), join(licenses, to));
}

console.log('vendor/books.mjs、pdf.worker.mjs 与许可证文件已生成');
