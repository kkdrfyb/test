# 第三方组件许可说明

`books.mjs` 与 `pdf.worker.mjs` 是本项目从下列开源组件打包生成的浏览器端产物，完整许可文本见 `licenses/` 目录。这些组件只在本地浏览器中运行，不会向外部服务上传书籍文件。

| 组件 | 版本 | 许可 | 用途 | 完整许可 |
|---|---|---|---|---|
| JSZip | 3.10.2 | MIT / GPLv3 双许可（本项目按 MIT 使用） | 解压 EPUB (ZIP) | `licenses/JSZip.txt` |
| pdf.js (pdfjs-dist) | 6.5.438 | Apache-2.0 | PDF 解析与页面渲染 | `licenses/pdf.js.txt` |
| chmlib-ts | 0.3.0 | LGPL-2.1 | CHM (ITSF/LZX) 解压与目录解析 | `licenses/chmlib-ts.txt` |
| esbuild | 0.28.2 | MIT | 仅开发期打包工具，不进入运行时产物 | — |

重新生成产物：先 `npm install`，再运行 `npm run build:vendor`。
