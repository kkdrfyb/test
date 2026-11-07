/**
 * 生成 Tauri 打包用的静态资源副本（frontendDist）。
 * 项目本身没有构建链，这里只做白名单复制，避免把依赖目录与 Rust 构建产物打进安装包。
 */
import { access, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'dist');

const files = [
  'index.html',
  'styles.css',
  'src/app.js',
  'src/backend.js',
  'src/db.js',
  'src/formats.js',
  'src/text.js',
  'src/shelf.js',
  'vendor/books.mjs',
  'vendor/pdf.worker.mjs',
  'vendor/tauri.mjs',
  'vendor/THIRD_PARTY_NOTICES.md',
];
const dirs = ['vendor/licenses'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const file of files) {
  const source = join(root, file);
  await access(source); // 缺文件直接失败，避免打出半个应用
  const target = join(out, file);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
}
for (const dir of dirs) {
  await cp(join(root, dir), join(out, dir), { recursive: true });
}

console.log(`dist 已生成：${files.length} 个文件 + ${dirs.length} 个目录`);
