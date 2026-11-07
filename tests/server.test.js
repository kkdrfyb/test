import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../server.js';

const root = fileURLToPath(new URL('../', import.meta.url));
let server;
let base;

before(async () => {
  server = createStaticServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('根路径返回首页 HTML', async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(await response.text(), /简读/);
});

test('CSS 与 JS 模块可访问且 MIME 正确', async () => {
  const css = await fetch(`${base}/styles.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const js = await fetch(`${base}/src/app.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
});

test('vendor 的 .mjs 模块与 pdf worker 可访问且 MIME 正确', async () => {
  for (const path of ['/vendor/books.mjs', '/vendor/pdf.worker.mjs', '/src/formats.js']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, `${path} 应可访问`);
    assert.match(response.headers.get('content-type'), /javascript/, `${path} MIME 应为 JS`);
  }
});

test('不存在的文件返回 404', async () => {
  const response = await fetch(`${base}/does-not-exist.txt`);
  assert.equal(response.status, 404);
});

test('目录穿越请求被拒绝，不会泄露项目外文件', async () => {
  // 编码斜杠可避免客户端 URL 层提前归一化，让穿越在服务端解码后才出现。
  const response = await fetch(`${base}/..%2F..%2Fpackage.json`);
  assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), /txt-reader-mvp/);
});
