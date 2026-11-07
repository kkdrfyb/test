import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as tauriApi from '../vendor/tauri.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => readFile(join(root, name), 'utf8');

test('Tauri 配置指向本地开发服务与静态副本，窗口与权限配置齐备', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  assert.equal(config.build.devUrl, 'http://localhost:5173');
  assert.equal(config.build.frontendDist, '../dist');
  assert.equal(config.identifier, 'com.jiandu.reader');
  assert.equal(config.app.windows[0].label, 'main');
  assert.equal(config.app.security.csp, null, '书籍内容含内联样式，CSP 由 sanitizeHtml 负责');
  assert.equal(config.bundle.active, false, '阶段 1 不产出安装包');

  const capability = JSON.parse(await read('src-tauri/capabilities/default.json'));
  assert.deepEqual(capability.windows, ['main']);
  assert.ok(capability.permissions.includes('dialog:allow-open'));
});

test('Cargo 把 Tauri 依赖隔离在可选 desktop feature 后面', async () => {
  const cargo = await read('src-tauri/Cargo.toml');
  assert.match(cargo, /\[\[bin\]\]\s*\nname = "jiandu"/);
  assert.match(cargo, /required-features = \["desktop"\]/);
  assert.match(cargo, /desktop = \["dep:tauri", "dep:tauri-plugin-dialog", "dep:tauri-build"\]/);
  assert.match(cargo, /tauri-build = \{ version = "2\.7\.4", optional = true \}/);
  assert.match(await read('src-tauri/build.rs'), /#\[cfg\(feature = "desktop"\)\]/);
  assert.match(cargo, /tauri = \{ version = "2\.12\.5", optional = true \}/);
  assert.match(cargo, /tauri-plugin-dialog = \{ version = "2\.8\.4", optional = true \}/);
  assert.match(cargo, /name = "scan"/, '阶段 0 的命令行扫描工具必须保留');
});

test('main.rs 注册全部书库命令并仅在桌面 feature 下编译', async () => {
  const [main, lib, commands] = await Promise.all([
    read('src-tauri/src/main.rs'), read('src-tauri/src/lib.rs'), read('src-tauri/src/commands.rs'),
  ]);
  for (const command of ['library_state', 'scan_library', 'read_book', 'save_progress', 'get_settings', 'save_settings']) {
    assert.match(main, new RegExp(`commands::${command}`), `缺少命令注册 ${command}`);
  }
  assert.match(main, /tauri_plugin_dialog::init\(\)/);
  assert.match(lib, /#\[cfg\(feature = "desktop"\)\]\s*\npub mod commands;/);
  assert.match(commands, /Response::new\(bytes\)/, '二进制必须走 Raw IPC 而非 JSON 数组');
  assert.match(commands, /Library::from_data/, '重扫必须沿用旧进度');
});

test('Windows 资源所需的 icon.ico 是有效 ICO 文件', async () => {
  const icon = await readFile(join(root, 'src-tauri/icons/icon.ico'));
  assert.ok(icon.length > 1000);
  assert.equal(icon.readUInt16LE(0), 0, 'ICO reserved');
  assert.equal(icon.readUInt16LE(2), 1, 'ICO type');
  assert.equal(icon.readUInt16LE(4), 1, '包含一张图片');
  assert.equal(icon.readUInt16LE(12), 32, '位深 32bpp');
});

test('vendor/tauri.mjs 自包含并导出 invoke / open', async () => {
  assert.equal(typeof tauriApi.invoke, 'function');
  assert.equal(typeof tauriApi.open, 'function');
  assert.ok((await stat(join(root, 'vendor/tauri.mjs'))).size > 1000);
  const source = await read('vendor/tauri.mjs');
  assert.doesNotMatch(source, /^import\s+.*from\s+["'][a-z@][^"']*["'];/m, '运行时不能依赖裸模块名');
});

test('dist 复制脚本采用白名单，只含运行时需要的文件', async () => {
  const script = await read('scripts/build-desktop.mjs');
  for (const file of ['index.html', 'styles.css', 'src/app.js', 'src/backend.js', 'src/db.js',
    'src/formats.js', 'src/text.js', 'vendor/books.mjs', 'vendor/pdf.worker.mjs', 'vendor/tauri.mjs']) {
    assert.match(script, new RegExp(`'${file.replace(/\./g, '\\.')}'`), `白名单缺少 ${file}`);
  }
  assert.doesNotMatch(script, /node_modules|src-tauri/);
  const ignored = await read('.gitignore');
  assert.match(ignored, /^dist\//m);
  assert.match(ignored, /^src-tauri\/gen\/schemas\//m, 'Tauri 生成物不应提交');
});

test('页面提供桌面书库控件且 app.js 改用统一适配层', async () => {
  const [html, app, css] = await Promise.all([
    read('index.html'), read('src/app.js'), read('styles.css'),
  ]);
  for (const id of ['desktopBar', 'scanBtn', 'libraryRootLabel', 'searchInput']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /from '\.\/backend\.js'/);
  assert.doesNotMatch(app, /from '\.\/db\.js'/);
  assert.match(app, /pickLibraryDir|scanLibrary/);
  assert.match(app, /SHELF_RENDER_LIMIT/);
  assert.match(css, /\.desktop-bar/);
  assert.match(css, /\.search-input/);
});

test('package.json 提供桌面构建与启动脚本', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.match(pkg.scripts['build:desktop'], /build-desktop\.mjs/);
  assert.match(pkg.scripts['dev:desktop'], /--features desktop --bin jiandu/);
  assert.equal(pkg.scripts['test:rust'], 'cargo test --manifest-path src-tauri/Cargo.toml', '默认测试不应编译 tauri');
  assert.ok(pkg.devDependencies['@tauri-apps/api']);
  assert.ok(pkg.devDependencies['@tauri-apps/plugin-dialog']);
  const notices = await read('vendor/THIRD_PARTY_NOTICES.md');
  assert.match(notices, /@tauri-apps\/api/);
  assert.match(notices, /@tauri-apps\/plugin-dialog/);
});
