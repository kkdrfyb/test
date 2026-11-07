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

test('页面支持四种格式并提供 PDF 分页工具', async () => {
  const [html, css] = await Promise.all([read('index.html'), read('styles.css')]);
  for (const ext of ['.txt', '.epub', '.pdf', '.chm']) assert.match(html, new RegExp(ext.replace('.', '\\.')));
  for (const id of ['pdfTools', 'pageInput', 'pageTotal', 'zoomSelect']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(css, /\.format-badge/);
  assert.match(css, /\.pdf-page canvas/);
  assert.match(css, /\.rich-content article img/);
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

test('书架提供分类、排序、视图切换与彻底删除确认框', async () => {
  const [html, css, app] = await Promise.all([
    read('index.html'), read('styles.css'), read('src/app.js'),
  ]);
  for (const id of ['shelfTitle', 'shelfTabBtn', 'trashTabBtn', 'trashCount', 'sortSelect',
    'viewToggleBtn', 'purgeDialog', 'purgeBookTitle', 'purgeBookPath', 'purgeCancelBtn',
    'purgeRecordOnlyBtn', 'purgeFileBtn']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const value of ['recent', 'title', 'progress', 'size', 'format']) {
    assert.match(html, new RegExp(`value="${value}"`));
  }
  assert.match(html, /此操作非常危险/, '彻底删除必须有明确警告');
  assert.match(html, /移入系统回收站/, '文件删除只能进入系统回收站');
  assert.match(css, /\.book-list\.list-view/);
  assert.match(css, /\.book-row/);
  assert.match(css, /\.dialog-backdrop/);
  assert.match(app, /from '\.\/shelf\.js'/);
  assert.match(app, /LIST_RENDER_LIMIT/);
  assert.match(app, /purgeBook\(/);
  assert.match(app, /createRow\(/);
});

test('package.json 提供 start、JS/Rust 测试与书库扫描脚本', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.type, 'module');
  assert.match(pkg.scripts.start, /node server\.js/);
  assert.equal(pkg.scripts['test:js'], 'node --test');
  assert.match(pkg.scripts['test:rust'], /cargo test --manifest-path src-tauri\/Cargo\.toml/);
  assert.match(pkg.scripts.test, /test:js/);
  assert.match(pkg.scripts.test, /test:rust/);
  assert.match(pkg.scripts.scan, /--bin scan/);
});

test('.gitignore 排除 Rust 构建产物，避免误提交', async () => {
  assert.match(await read('.gitignore'), /src-tauri\/target\//);
});
