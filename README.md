# 简读 · 本地电子书阅读器

一个**完全离线**的电子书阅读器：书籍解析、渲染、书架和阅读进度都在本机完成，不上传任何文件，也不需要账号或云服务。

同一套前端代码有两种运行形态：**浏览器 Web 应用**（拖拽导入，数据存 IndexedDB）和 **Windows 桌面客户端**（Tauri 2，直接扫描本地书库目录，不需要把书复制进应用）。

- 仓库：<https://github.com/kkdrfyb/test>
- 当前版本：`0.2.0`
- 下载安装包：<https://github.com/kkdrfyb/test/releases/latest>

---

## 功能一览

### 支持格式

| 格式 | 处理方式 |
|---|---|
| TXT | UTF-8 / GBK 自动识别，自动识别章节标题，支持大文件分章阅读 |
| EPUB | 用 JSZip 解包，按 `container.xml` + OPF spine 顺序读取，生成章节目录 |
| PDF | pdf.js（legacy 构建）渲染到 canvas，支持页码跳转与 80%–200% 缩放 |
| CHM | chmlib-ts 解压 ITSF/LZX，兼容无 `.hhc` 文本目录的老式书（从页面 `<title>` 生成目录）、GB18030 中文元数据与 `#SYSTEM` 编码回退 |

### 阅读体验

- 章节目录跳转、上一章 / 下一章、进度条与百分比，**关闭后自动记忆阅读位置**
- 三种主题（明亮 / 护眼 / 夜间），可调字号、行距、页宽
- 书籍 HTML 内容统一经过白名单清洗，不执行脚本、不加载外部资源

### 书架管理

- 点击导入或拖拽添加，按书名实时筛选
- 五种排序：最近阅读、书名、阅读进度、文件大小、格式（中文自然排序，第 2 章排在第 10 章前）
- 卡片视图（默认）与紧凑列表视图可切换，列表视图带名次序号
- **应用内回收站**：移除的书可恢复；彻底删除可选「仅清除记录」或「移入系统回收站」（桌面端，文件可恢复，绝不做永久删除）

### 桌面端专属

- 选择一个目录即扫描整柜书籍，支持上千本量级（实测 2635 本），**不复制、不改动原文件**
- 重新扫描会保留已有阅读进度
- 索引与设置写在 `%APPDATA%\com.jiandu.reader\library.json` / `settings.json`，用原子写保存

---

## 两种运行形态

| | 浏览器 Web 应用 | Windows 桌面客户端 |
|---|---|---|
| 适合 | 快速体验、开发调试 | 日常阅读、整柜书库 |
| 启动 | `npm start` 后打开 `http://localhost:5173` | 双击 exe 或安装 MSI |
| 添加书籍 | 导入 / 拖拽，文件存入浏览器 | 选择书库目录，直接读磁盘文件 |
| 数据存放 | 浏览器 IndexedDB | `%APPDATA%\com.jiandu.reader\` |
| 前置依赖 | 现代浏览器 | Windows 10/11 + WebView2 Runtime |

前端通过 `src/backend.js` 这一层统一接口适配两种后端，页面逻辑（`src/app.js`）不关心数据来自 IndexedDB 还是 Rust。

---

## 直接使用（不需要开发环境）

到 [Releases 页面](https://github.com/kkdrfyb/test/releases/latest) 下载其中一个即可：

- `简读_0.2.0_x64_zh-CN.msi` — 中文安装界面，带开始菜单 / 桌面快捷方式、卸载入口，安装包内已内嵌 WebView2 引导器
- `jiandu.exe` — 免安装单文件，前端资源已内嵌，双击即用

首次运行书库是空的：点「选择书库目录」挑一个放电子书的文件夹即可。老一点的 Win10 若未预装 WebView2 运行时，安装时会联网下载运行时本体（多数 Win10/Win11 已自带）。

> 注意：书和阅读进度**不随程序分发**，都保存在各自电脑上，换机器或发给别人时会得到空书库。

---

## 本地开发

需要 Node.js（建议 20+）；桌面客户端还需要 Rust 工具链与 Tauri 2 的 Windows 环境。

```bash
git clone https://github.com/kkdrfyb/test.git
cd test
npm install
```

### 浏览器版

```bash
npm start          # http://localhost:5173
```

`server.js` 是零额外依赖的静态服务器，带目录穿越防护。打开页面后拖入 `.txt / .epub / .pdf / .chm` 文件即可阅读，数据存浏览器 IndexedDB。

### 桌面客户端

```bash
npm run build:exe            # 生成 debug 版窗口程序
npm run build:release        # 生成 release 单文件
npm run build:msi            # 生成 WiX MSI 安装包（含上一步）
```

产物路径：

- `src-tauri/target/release/jiandu.exe`
- `src-tauri/target/release/bundle/msi/简读_0.2.0_x64_zh-CN.msi`

开发调试时用 `npm run dev:desktop`，它加载 `http://localhost:5173`，**需要另开一个终端先跑 `npm start`**；`build:exe` / `build:release` / `build:msi` 会启用 `custom-protocol` 把 `dist/` 内嵌进程序，**不依赖本地服务器**。需要看控制台日志时用 `npm run dev:desktop:console`。

### 命令速查

| 命令 | 作用 |
|---|---|
| `npm start` | 启动本地静态服务（默认端口 5173，可用 `PORT` 覆盖） |
| `npm test` | 全量测试 = `test:js` + `test:rust` |
| `npm run test:js` | `node --test`，前端纯函数与配置一致性测试 |
| `npm run test:rust` | `cargo test`，书库索引 / 路径安全等测试 |
| `npm run build:vendor` | 用 esbuild 重建 `vendor/*.mjs` 浏览器端依赖产物 |
| `npm run build:desktop` | 按白名单生成 `dist/`（Tauri 的 `frontendDist`） |
| `npm run scan -- <目录>` | 命令行扫描书库目录（调试用） |
| `npm run dev:desktop` | 桌面开发窗口（需先 `npm start`） |
| `npm run build:exe` | debug 版 exe |
| `npm run build:release` | release 版 exe |
| `npm run build:msi` | release exe + MSI 安装包 |
| `npm run dev:desktop:console` | 带控制台的调试窗口 |

---

## 项目结构

```
index.html / styles.css        页面骨架与样式
src/
  app.js                      书架与阅读器交互
  backend.js                  浏览器 / 桌面统一数据接口
  db.js                       IndexedDB 存储
  formats.js                  TXT / EPUB / PDF / CHM 解析、HTML 清洗
  text.js                     文本解码、章节识别、分段
  shelf.js                    筛选、排序、展示文案（纯函数）
vendor/                       esbuild 打包的浏览器端依赖与许可文本
scripts/
  build-vendor.mjs            生成 vendor 产物
  build-desktop.mjs           生成 dist（白名单复制）
server.js                     零依赖静态服务器
src-tauri/
  src/library.rs              书库扫描、索引、回收站、路径安全（Rust）
  src/commands.rs             Tauri IPC 命令
  src/main.rs                 桌面窗口入口（默认 GUI 子系统）
  tauri.conf.json             窗口、bundle 与 WebView2 配置
  capabilities/default.json   窗口权限白名单
tests/                        JS 与 Rust 测试、CHM 样例
dist/                         打包用静态资源副本（自动生成，不提交）
```

---

## 打包与分发要点

- **只发 MSI 或 release exe**，不要发 `src-tauri/target/`、`node_modules/`、`dist/` 或源码目录。前端已内嵌进 exe，`dist/` 只是构建中间副本。
- `src-tauri/target/` 是 Rust 的编译缓存：依赖编译产物、增量缓存、build script 输出与 `.pdb` 调试符号，通常 5 GB 以上（软件变大时主要随依赖数量和构建次数增长，与 exe 体积无关），**已在 `.gitignore` 中排除**。清理：`cargo clean` 全清，或只删 `target/debug/incremental/` 立刻省约 2 GB（下次编译会变慢）。
- MSI 采用中文安装界面，通过 `embedBootstrapper` 内置 WebView2 引导器；发布构建分两步（先明确编译 `jiandu` 主程序，再让 Tauri CLI 只做打包），避免把命令行扫描工具误当主程序打进安装包。

---

## 测试

项目约定见 [AGENTS.md](AGENTS.md)：**每次改动都要有对应 commit，并编写 / 更新测试，交付前确保全部通过**。

```bash
npm test
```

- 前端用 Node 自带 `node:test` 测纯函数（文本解析、格式识别、排序、HTML 清洗、配置一致性），不依赖浏览器。
- Rust 侧 `cargo test` 默认不启用 `desktop` feature，因此不需要编译 Tauri，几秒即可跑完。
- 桌面功能另用 Chrome DevTools Protocol 做过端到端回归：四种格式阅读、PDF canvas、2635 本大书库、进度持久化、移除 → 回收站 → 恢复 / 彻底删除、排序与视图切换。

---

## 常见问题

**导入 CHM 提示「没有可阅读的页面」？**
标准 ITSF 格式都已兼容，包括没有 `.hhc` 目录、中文元数据乱码的老书。若文件头不是 `ITSF`（例如某些经过二次打包的 `CB_?~` 文件），它不是标准 CHM，程序会给出明确错误，需要换用标准 CHM 文件。

**桌面 exe 双击弹出空白命令行窗口？**
已修复：默认构建是 Windows GUI 子系统（PE subsystem = 2）。需要看日志时才用 `npm run dev:desktop:console`。

**`dev:desktop` 打开是空界面 / 资源加载失败？**
该模式加载 `http://localhost:5173`，需先运行 `npm start`；打包版（`build:exe` 及以上）不需要。

**发给别人后书库是空的？**
正常。书籍文件与阅读进度都存在各自电脑上，对方需要自己选择书库目录。

---

## 第三方许可

浏览器端打包依赖（JSZip、pdf.js、chmlib-ts、Tauri API/CLI）与 Rust 依赖的许可说明见 [vendor/THIRD_PARTY_NOTICES.md](vendor/THIRD_PARTY_NOTICES.md)，完整许可文本在 `vendor/licenses/`。

## 分支与版本

- `main`：浏览器 Web 版稳定线（到 CHM 兼容性修复）
- `desktop-client`：当前开发线，包含 Tauri 2 桌面客户端、书架增强与 MSI 打包，本 README 描述的就是这条线的完整功能
