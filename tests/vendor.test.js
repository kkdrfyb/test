import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as books from '../vendor/books.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => readFile(join(root, name), 'utf8');

test('打包产物导出 EPUB/PDF/CHM 所需的全部解析能力', () => {
  for (const name of ['JSZip', 'pdfjsLib', 'ChmFile', 'chmReaderFromBuffer', 'parseSystemInfo', 'parseToc', 'ChmEnumerateFlags']) {
    assert.ok(books[name], `缺少导出 ${name}`);
  }
  assert.equal(typeof books.pdfjsLib.getDocument, 'function');
  assert.ok(books.pdfjsLib.GlobalWorkerOptions);
});

test('JSZip 可解压 ZIP（EPUB 的容器格式）', async () => {
  const zip = new books.JSZip();
  zip.file('mimetype', 'application/epub+zip');
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const reopened = await books.JSZip.loadAsync(bytes);
  assert.equal(await reopened.file('mimetype').async('string'), 'application/epub+zip');
});

test('parseToc 能解析 CHM 的 .hhc 目录树', () => {
  const hhc = `<ul><li><object type="text/sitemap">
    <param name="Name" value="第一章"><param name="Local" value="chap1.html">
    </object><ul><li><object type="text/sitemap">
    <param name="Name" value="小节"><param name="Local" value="chap1.html#s1">
    </object></li></ul></li></ul>`;
  const { entries } = books.parseToc(hhc);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, '第一章');
  assert.equal(entries[0].local, 'chap1.html');
  assert.equal(entries[0].children[0].name, '小节');
});

test('parseSystemInfo 能解析 CHM /#SYSTEM 元数据', () => {
  const field = (code, value) => {
    const bytes = new TextEncoder().encode(`${value}\0`);
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint16(0, code, true);
    new DataView(header.buffer).setUint16(2, bytes.length, true);
    return new Uint8Array([...header, ...bytes]);
  };
  const version = new Uint8Array(4);
  const body = [...field(0, '/toc.hhc'), ...field(2, '/index.html'), ...field(3, '测试手册')];
  const info = books.parseSystemInfo(new Uint8Array([...version, ...body]));
  assert.equal(info.tocFile, '/toc.hhc');
  assert.equal(info.defaultTopic, '/index.html');
  assert.equal(info.title, '测试手册');
});

test('打包产物自包含：无裸模块导入，worker 与许可证文件齐备', async () => {
  const bundle = await read('vendor/books.mjs');
  assert.ok(bundle.length > 100_000);
  assert.doesNotMatch(bundle, /^import\s+.*from\s+["'][a-z@][^"']*["'];/m);
  assert.doesNotMatch(bundle, /from\s+["']fs\/promises["']/);
  for (const file of ['vendor/pdf.worker.mjs', 'vendor/licenses/JSZip.txt', 'vendor/licenses/pdf.js.txt', 'vendor/licenses/chmlib-ts.txt', 'vendor/THIRD_PARTY_NOTICES.md']) {
    assert.ok((await stat(join(root, file))).size > 0, `缺少 ${file}`);
  }
});
