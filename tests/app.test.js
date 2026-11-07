import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => readFile(join(root, name), 'utf8');

test('页面引用的静态资源都真实存在且均为本地文件', async () => {
  const html = await read('index.html');
  assert.match(html, /<link rel="stylesheet" href="\.\/styles\.css">/);
  assert.match(html, /<script type="module" src="\.\/src\/app\.js">/);
  assert.doesNotMatch(html, /https?:\/\//, '不应依赖外部 CDN');
  assert.ok((await read('styles.css')).length > 0);
  assert.ok((await read('src/app.js')).length > 0);
  assert.ok((await read('src/db.js')).length > 0);
});

test('app.js 中用到的所有元素 id 都在 index.html 中定义', async () => {
  const [html, app] = await Promise.all([read('index.html'), read('src/app.js')]);
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const usedIds = [...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(usedIds.length > 20, '应当确实解析出元素引用');
  for (const id of usedIds) assert.ok(htmlIds.has(id), `缺少元素 #${id}`);
});

test('样式表覆盖三种主题与四项阅读设置变量', async () => {
  const css = await read('styles.css');
  assert.match(css, /body\[data-theme="sepia"\]/);
  assert.match(css, /body\[data-theme="dark"\]/);
  for (const variable of ['--font-size', '--line-height', '--page-width']) {
    assert.match(css, new RegExp(variable.replace(/-/g, '\\-')));
  }
  assert.match(css, /\.toc-item\.active/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('package.json 提供 start 与 test 脚本', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.type, 'module');
  assert.match(pkg.scripts.start, /node server\.js/);
  assert.match(pkg.scripts.test, /node --test/);
});
