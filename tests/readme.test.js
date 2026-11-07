import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => readFile(join(root, name), 'utf8');

const SECTIONS = [
  '功能一览', '两种运行形态', '直接使用', '本地开发', '命令速查', '项目结构',
  '打包与分发要点', '测试', '常见问题', '第三方许可', '分支与版本',
];

test('README 覆盖项目介绍、使用方式与分发说明', async () => {
  const readme = await read('README.md');
  for (const section of SECTIONS) {
    assert.ok(readme.includes(`## ${section}`), `README 缺少章节：${section}`);
  }
  for (const format of ['TXT', 'EPUB', 'PDF', 'CHM']) {
    assert.match(readme, new RegExp(`\\| ${format} \\|`), `格式表缺少 ${format}`);
  }
  assert.match(readme, /不上传|完全离线/, '必须说明本地处理、不上传书籍');
  assert.match(readme, /http:\/\/localhost:5173/, '浏览器版启动地址');
  assert.match(readme, /IndexedDB/, '浏览器版存储方式');
  assert.match(readme, /%APPDATA%\\com\.jiandu\.reader\\/, '桌面版数据目录');
  assert.match(readme, /选择书库目录/, '桌面版首次使用方式');
  assert.match(readme, /AGENTS\.md/, '项目约定入口');
});

test('README 列出的 npm 命令都真实存在于 package.json', async () => {
  const [readme, pkgText] = await Promise.all([read('README.md'), read('package.json')]);
  const pkg = JSON.parse(pkgText);
  const mentioned = new Set(
    [...readme.matchAll(/npm (?:run )?([a-z][a-z0-9:-]*)/g)].map((match) => match[1]),
  );
  assert.ok(mentioned.size >= 10, '命令速查应覆盖主要脚本');
  for (const name of mentioned) {
    if (name === 'install') continue;
    assert.ok(pkg.scripts[name], `README 提到 npm ${name}，但 package.json 没有该脚本`);
  }
  for (const required of [
    'start', 'test', 'test:js', 'test:rust', 'build:vendor', 'build:desktop',
    'build:exe', 'build:release', 'build:msi', 'dev:desktop',
    'dev:desktop:console', 'scan',
  ]) {
    assert.ok(mentioned.has(required), `README 缺少命令说明：${required}`);
  }
});

test('README 的版本、下载与产物路径与实际配置一致', async () => {
  const [readme, pkgText, configText] = await Promise.all([
    read('README.md'), read('package.json'), read('src-tauri/tauri.conf.json'),
  ]);
  const pkg = JSON.parse(pkgText);
  const config = JSON.parse(configText);
  const version = pkg.version.replace(/\./g, '\\.');
  assert.equal(config.version, pkg.version, 'Tauri 版本号必须与 package.json 一致');
  assert.equal(config.productName, '简读');
  assert.match(readme, /https:\/\/github\.com\/kkdrfyb\/test\/releases\/latest/, 'Releases 下载入口');
  assert.match(readme, new RegExp(`\`${version}\``), 'README 应写明当前版本');
  assert.match(readme, new RegExp(`简读_${version}_x64_zh-CN\\.msi`), 'MSI 文件名与打包配置一致');
  assert.match(readme, /src-tauri\/target\/release\/jiandu\.exe/, '免安装 exe 路径');
  assert.match(readme, /src-tauri\/target\//, '需说明编译缓存不随程序分发');
  assert.match(readme, /cargo clean/, '需给出缓存清理方式');
  assert.match(readme, /src-tauri\/target\/release\/bundle\/msi\//, 'MSI 产物路径');
});

test('README 声明的格式与代码里的 SUPPORTED_EXTENSIONS 一致', async () => {
  const [readme, formats, library] = await Promise.all([
    read('README.md'), read('src/formats.js'), read('src-tauri/src/library.rs'),
  ]);
  const declaration = formats.match(/export const SUPPORTED_EXTENSIONS = \[([^\]]+)\]/);
  assert.ok(declaration, 'formats.js 必须导出支持格式列表');
  const extensions = [...declaration[1].matchAll(/'([a-z]+)'/g)].map((match) => match[1]);
  assert.deepEqual(extensions, ['txt', 'epub', 'pdf', 'chm']);
  for (const ext of extensions) {
    assert.match(readme, new RegExp(`\\.${ext}\\b`, 'i'), `README 未提到 .${ext}`);
  }
  assert.match(library, /\["txt", "epub", "pdf", "chm"\]/, 'Rust 侧支持格式必须一致');
});
