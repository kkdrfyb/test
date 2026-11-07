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
  assert.equal(config.mainBinaryName, 'jiandu', '存在 scan 与 jiandu 两个 bin，打包必须指定主程序');
  assert.deepEqual(config.build.features, ['custom-protocol'], '发布包必须内嵌 frontendDist，不能依赖 devUrl');
  assert.equal(config.bundle.active, true);

  const capability = JSON.parse(await read('src-tauri/capabilities/default.json'));
  assert.deepEqual(capability.windows, ['main']);
  assert.ok(capability.permissions.includes('dialog:allow-open'));
});

test('MSI 安装包配置完整，分发时只需发送一个安装文件', async () => {
  const [configText, pkgText, ignored] = await Promise.all([
    read('src-tauri/tauri.conf.json'), read('package.json'), read('.gitignore'),
  ]);
  const config = JSON.parse(configText);
  const pkg = JSON.parse(pkgText);
  assert.equal(config.build.beforeBuildCommand, 'npm run build:desktop', '打包前必须先生成 dist');
  assert.deepEqual(config.bundle.targets, ['msi']);
  assert.deepEqual(config.bundle.icon, ['icons/icon.ico']);
  assert.equal(config.bundle.publisher, 'fanyb');
  assert.equal(config.bundle.windows.webviewInstallMode.type, 'embedBootstrapper',
    '安装程序自带 WebView2 引导器，避免用户手动下载');
  assert.equal(config.bundle.windows.wix.language, 'zh-CN');
  assert.match(pkg.scripts['build:msi'], /npm run build:release && tauri bundle --bundles=msi/,
    '必须显式编译 jiandu 主程序后再打包；tauri build 会把 scan 误当成主程序');
  assert.match(pkg.scripts['build:release'], /cargo build --release.*--bin jiandu/);
  assert.match(pkg.scripts['build:msi'], /--features=custom-protocol/);
  assert.doesNotMatch(pkg.scripts['build:msi'], /tauri build\b/);
  assert.ok(pkg.devDependencies['@tauri-apps/cli'], 'MSI 打包需要 Tauri CLI');
  assert.match(ignored, /^src-tauri\/target\//m, '安装包与编译产物都不应提交');
});

test('发布构建只产出窗口主程序，命令行扫描器不会顶替 MSI 主文件', async () => {
  const [cargo, pkgText, configText] = await Promise.all([
    read('src-tauri/Cargo.toml'), read('package.json'), read('src-tauri/tauri.conf.json'),
  ]);
  assert.match(cargo, /\[\[bin\]\]\s*\nname = "jiandu"[\s\S]*?\[\[bin\]\]\s*\nname = "scan"/,
    '主程序必须排在第一个 bin，Tauri CLI 按声明顺序挑选主程序');
  assert.match(cargo, /name = "scan"\s*\npath = "src\/bin\/scan\.rs"\s*\nrequired-features = \["cli"\]/,
    'scan 必须从发布构建中排除，否则 371KB 的命令行工具会被打进安装包');
  assert.match(cargo, /^cli = \[\]$/m);
  assert.match(JSON.parse(pkgText).scripts.scan, /--features cli --bin scan/,
    '扫描工具仍要能通过 npm run scan 单独运行');
  assert.equal(JSON.parse(configText).mainBinaryName, 'jiandu');
});

test('Cargo 把 Tauri 依赖隔离在可选 desktop feature 后面', async () => {
  const cargo = await read('src-tauri/Cargo.toml');
  assert.match(cargo, /\[\[bin\]\]\s*\nname = "jiandu"/);
  assert.match(cargo, /required-features = \["desktop"\]/);
  assert.match(cargo, /desktop = \["dep:tauri", "dep:tauri-plugin-dialog", "dep:tauri-build", "dep:trash"\]/);
  assert.match(cargo, /tauri-build = \{ version = "2\.7\.4", optional = true/,
    'Tauri CLI 会自行同步 features = []，只锁定版本与可选依赖');
  assert.match(await read('src-tauri/build.rs'), /#\[cfg\(feature = "desktop"\)\]/);
  assert.match(await read('src-tauri/build.rs'), /rerun-if-changed=\.\.\/dist/,
    '静态资源变化必须让 Tauri 重新内嵌 frontendDist');
  assert.match(cargo, /tauri = \{ version = "2\.12\.5", optional = true/);
  assert.match(cargo, /tauri-plugin-dialog = \{ version = "2\.8\.4", optional = true \}/);
  assert.match(cargo, /name = "scan"/, '阶段 0 的命令行扫描工具必须保留');
  assert.match(cargo, /custom-protocol = \["desktop", "tauri\/custom-protocol"\]/,
    '独立窗口必须能内嵌 frontendDist，而不是依赖 devUrl');
  assert.match(cargo, /^console = \[\]$/m, '保留调试时显示控制台的开关');
});

test('main.rs 注册全部书库命令并仅在桌面 feature 下编译', async () => {
  const [main, lib, commands] = await Promise.all([
    read('src-tauri/src/main.rs'), read('src-tauri/src/lib.rs'), read('src-tauri/src/commands.rs'),
  ]);
  for (const command of ['library_state', 'scan_library', 'read_book', 'save_progress',
    'remove_book', 'restore_book', 'purge_book', 'get_settings', 'save_settings']) {
    assert.match(main, new RegExp(`commands::${command}`), `缺少命令注册 ${command}`);
  }
  assert.match(main, /tauri_plugin_dialog::init\(\)/);
  assert.match(lib, /#\[cfg\(feature = "desktop"\)\]\s*\npub mod commands;/);
  assert.match(commands, /Response::new\(bytes\)/, '二进制必须走 Raw IPC 而非 JSON 数组');
  assert.match(commands, /Library::from_data/, '重扫必须沿用旧进度');
  assert.match(commands, /trash::delete\(&path\)/, '彻底删除文件只能移入系统回收站');
  assert.match(commands, /resolve_book_path\(&book\.path\)/, '删除磁盘文件前必须校验路径未越界');
  assert.doesNotMatch(main, /cfg_attr\(not\(debug_assertions\)/,
    'debug 构建也必须隐藏控制台，否则双击 exe 会弹出空白命令行窗口');
  assert.match(main, /all\(target_os = "windows", not\(feature = "console"\)\)/);
  assert.match(main, /windows_subsystem = "windows"/);
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
  for (const file of ['index.html', 'styles.css',     'src/app.js', 'src/backend.js', 'src/db.js',
    'src/formats.js', 'src/text.js', 'src/shelf.js',
    'vendor/books.mjs', 'vendor/pdf.worker.mjs', 'vendor/tauri.mjs']) {
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
  for (const id of ['desktopBar', 'scanBtn', 'libraryRootLabel', 'searchInput',
    'sortSelect', 'viewToggleBtn', 'trashTabBtn', 'purgeDialog']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /from '\.\/backend\.js'/);
  assert.doesNotMatch(app, /from '\.\/db\.js'/);
  assert.match(app, /pickLibraryDir|scanLibrary/);
  assert.match(app, /SHELF_RENDER_LIMIT/);
  assert.match(app, /getTrashBooks|removeBook|restoreBook|purgeBook/,
    '桌面书架必须接入应用内回收站');
  assert.match(css, /\.desktop-bar/);
  assert.match(css, /\.search-input/);
});

test('package.json 提供桌面构建与启动脚本', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.match(pkg.scripts['build:desktop'], /build-desktop\.mjs/);
  assert.match(pkg.scripts['dev:desktop'], /--features desktop --bin jiandu/);
  assert.match(pkg.scripts['build:exe'], /--features custom-protocol --bin jiandu/);
  assert.match(pkg.scripts['dev:desktop:console'], /--features desktop,console --bin jiandu/);
  assert.equal(pkg.scripts['test:rust'], 'cargo test --manifest-path src-tauri/Cargo.toml', '默认测试不应编译 tauri');
  assert.ok(pkg.devDependencies['@tauri-apps/api']);
  assert.ok(pkg.devDependencies['@tauri-apps/plugin-dialog']);
  const notices = await read('vendor/THIRD_PARTY_NOTICES.md');
  assert.match(notices, /@tauri-apps\/api/);
  assert.match(notices, /@tauri-apps\/plugin-dialog/);
  assert.match(notices, /@tauri-apps\/cli/, '新增的构建工具也需列明许可');
});
