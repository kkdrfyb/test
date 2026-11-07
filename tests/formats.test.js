import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { JSZip } from '../vendor/books.mjs';
import {
  detectFormat,
  parseContainerXml,
  parseOpf,
  parseNavHtml,
  parseNcx,
  resolveZipPath,
  flattenToc,
  normalizeChmPath,
  decodeChmText,
  parseChmSystem,
  extractHtmlTitle,
  collectChmPages,
  sanitizeHtml,
  inlineImages,
  inspectFile,
  createDocument,
} from '../src/formats.js';

const root = fileURLToPath(new URL('../', import.meta.url));

function fakeFile(name, type, buffer) {
  return { name, type, size: buffer.byteLength, arrayBuffer: async () => buffer };
}

async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试电子书 &amp; 更多</dc:title></metadata>
    <manifest>
      <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
      <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
      <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
      <item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    </manifest>
    <spine toc="toc"><itemref idref="c1"/><itemref idref="c2"/></spine>
  </package>`);
  zip.file('OEBPS/nav.xhtml', '<nav><ol><li><a href="text/ch1.xhtml">第一章 开始</a></li><li><a href="text/ch2.xhtml">第二章 结束</a></li></ol></nav>');
  zip.file('OEBPS/text/ch1.xhtml', '<html><head><title>x</title><style>p{color:red}</style></head><body><h1>第一章</h1><p onclick="alert(1)">第一段<script>alert(2)</script></p><img src="../images/a.png"><a href="javascript:alert(3)">危险链接</a></body></html>');
  zip.file('OEBPS/text/ch2.xhtml', '<html><body><p>最后一章内容</p></body></html>');
  zip.file('OEBPS/images/a.png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x01]));
  return zip.generateAsync({ type: 'arraybuffer' });
}

function makePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf).buffer;
}

test('detectFormat 覆盖四种格式、大小写与 MIME 回退', () => {
  assert.equal(detectFormat('book.TXT'), 'txt');
  assert.equal(detectFormat('a.epub'), 'epub');
  assert.equal(detectFormat('b.PDF'), 'pdf');
  assert.equal(detectFormat('c.chm'), 'chm');
  assert.equal(detectFormat('unknown', 'application/epub+zip'), 'epub');
  assert.equal(detectFormat('unknown', 'application/vnd.ms-htmlhelp'), 'chm');
  assert.equal(detectFormat('a.mobi'), null);
});

test('parseContainerXml / parseOpf 提取 OPF 路径、书名、spine 与目录文件', () => {
  const container = '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>';
  assert.equal(parseContainerXml(container), 'OEBPS/content.opf');
  const opf = `<package><metadata><dc:title>甲 &amp; 乙</dc:title></metadata>
    <manifest><item id="nav" href="nav.xhtml" properties="nav"/>
    <item id="ncx" href="toc.ncx"/><item id="c1" href="ch1.xhtml"/></manifest>
    <spine toc="ncx"><itemref idref="c1"/></spine></package>`;
  const parsed = parseOpf(opf);
  assert.equal(parsed.title, '甲 & 乙');
  assert.deepEqual(parsed.spine, ['ch1.xhtml']);
  assert.equal(parsed.navHref, 'nav.xhtml');
  assert.equal(parsed.ncxHref, 'toc.ncx');
});

test('parseNavHtml 与 parseNcx 归一化为章节目录', () => {
  assert.deepEqual(parseNavHtml('<ol><li><a href="text/a.xhtml">第一章 &amp; 序</a></li></ol>'),
    [{ title: '第一章 & 序', href: 'text/a.xhtml' }]);
  assert.deepEqual(parseNcx('<navPoint><navLabel><text>第二章</text></navLabel><content src="text/b.xhtml"/></navPoint>'),
    [{ title: '第二章', href: 'text/b.xhtml' }]);
});

test('resolveZipPath 处理相对路径、上级目录与锚点', () => {
  assert.equal(resolveZipPath('OEBPS/', 'text/ch1.xhtml'), 'OEBPS/text/ch1.xhtml');
  assert.equal(resolveZipPath('OEBPS/text/', '../images/a.png#x'), 'OEBPS/images/a.png');
  assert.equal(resolveZipPath('OEBPS/', '/root.xhtml'), 'root.xhtml');
});

test('flattenToc 与 normalizeChmPath 处理 CHM 目录树和路径', () => {
  const entries = [{ name: '第一章', local: 'ch1.html', children: [{ name: '小节', local: 'ch1.html#s1' }] }];
  assert.deepEqual(flattenToc(entries), [
    { title: '第一章', local: 'ch1.html', depth: 0 },
    { title: '小节', local: 'ch1.html#s1', depth: 1 },
  ]);
  assert.equal(normalizeChmPath('../images/a.png', '/pages/ch1.html'), '/images/a.png');
  assert.equal(normalizeChmPath('chapter1.html#top'), '/chapter1.html');
  assert.equal(normalizeChmPath('https://example.com/x.png'), 'https://example.com/x.png');
});

test('decodeChmText 兼容 GBK 编码的中文页面', () => {
  // GBK 编码的「中文页面」：D6D0 CEC4 D2B3 C3E6
  const bytes = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 0xd2, 0xb3, 0xc3, 0xe6]);
  assert.equal(decodeChmText(bytes), '中文页面');
  assert.equal(decodeChmText(new TextEncoder().encode('UTF-8 文本')), 'UTF-8 文本');
});

/** 构造 /#SYSTEM 二进制记录：4 字节版本头 + (code:uint16, len:uint16, data)*。 */
function makeChmSystem(records) {
  const chunks = [Uint8Array.from([1, 0, 0, 0])];
  for (const [code, data] of records) {
    const head = new Uint8Array(4);
    const view = new DataView(head.buffer);
    view.setUint16(0, code, true);
    view.setUint16(2, data.length, true);
    chunks.push(head, data);
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

const nul = (text) => Uint8Array.from([...new TextEncoder().encode(text), 0]);

test('parseChmSystem 兼容 GBK 中文标题并去掉 HHA 包裹的引号', () => {
  // “中文页面”的 GBK 字节，前后加英文双引号，正是 HTML Help Workshop 的常见写法
  const gbkTitle = Uint8Array.from([0x22, 0xd6, 0xd0, 0xce, 0xc4, 0xd2, 0xb3, 0xc3, 0xe6, 0x22, 0]);
  const info = parseChmSystem(makeChmSystem([
    [0, nul('toc.hhc')],
    [2, nul('01.htm')],
    [3, gbkTitle],
    [6, Uint8Array.from([1, 0, 0, 0])],
  ]));
  assert.equal(info.title, '中文页面');
  assert.equal(info.tocFile, 'toc.hhc');
  assert.equal(info.defaultTopic, '01.htm');
  assert.equal(info.binaryToc, true);
  assert.equal(parseChmSystem(makeChmSystem([[3, nul('UTF-8 标题')]])).title, 'UTF-8 标题');
  // 老式 CHM 没有 code 0，必须允许目录字段缺失，由页面枚举兜底
  assert.equal(parseChmSystem(makeChmSystem([[3, nul('无目录手册')]])).tocFile, undefined);
});

test('extractHtmlTitle 从页面标题取章节名并做实体解码与长度防护', () => {
  assert.equal(extractHtmlTitle('<html><head><title>第一章 &amp; 起</title></head></html>'), '第一章 & 起');
  assert.equal(extractHtmlTitle('<title>  楔子  夜雨空山  </title>'), '楔子 夜雨空山');
  assert.equal(extractHtmlTitle('<body>无标题</body>'), null);
  assert.equal(extractHtmlTitle('<title></title>'), null);
  assert.equal(extractHtmlTitle(`<title>${'x'.repeat(200)}</title>`), null);
});

test('collectChmPages 过滤系统文件、去重并按文件名自然排序', () => {
  const paths = [
    '/10.htm', '/2.htm', '/01.htm', '/#SYSTEM', '/$WWAssociativeLinks/link.htm',
    '/all.css', '/img/a.PNG', '/01.htm', '::DataSpace/NameList',
  ];
  const pages = collectChmPages(paths.map((path) => ({ path })));
  assert.deepEqual(pages.map((page) => page.local), ['/01.htm', '/2.htm', '/10.htm']);
  assert.equal(pages[0].title, '01');
  assert.equal(pages.every((page) => page.depth === 0), true);
  assert.equal(collectChmPages(paths.map((path) => ({ path })), 2).length, 2);
});

test('sanitizeHtml 清除脚本、样式、事件属性与 javascript 链接', () => {
  const dirty = '<html><head><style>x{}</style></head><body><p onclick="evil()">正文<script>bad()</script></p><a href="javascript:evil()">链接</a><iframe src="x"></iframe></body></html>';
  const clean = sanitizeHtml(dirty);
  assert.match(clean, /正文/);
  assert.doesNotMatch(clean, /<script|<style|<iframe|onclick|javascript:/i);
  assert.match(clean, /href="#"/);
});

test('inlineImages 把相对图片路径替换为 data URL', async () => {
  const html = '<p><img src="a.png"><img src="https://x/b.png"><img src="data:image/png;base64,AA"></p>';
  const result = await inlineImages(html, async (src) => (src === 'a.png' ? 'data:image/png;base64,QQ' : null));
  assert.match(result, /src="data:image\/png;base64,QQ"/);
  assert.match(result, /src="https:\/\/x\/b\.png"/);
  assert.match(result, /src="data:image\/png;base64,AA"/);
});

test('inspectFile 解析 TXT（UTF-8 与 GBK）', async () => {
  const utf8 = new TextEncoder().encode('\uFEFF第一章 起\n正文\r\n').buffer;
  const info = await inspectFile(fakeFile('novel.txt', 'text/plain', utf8));
  assert.equal(info.book.format, 'txt');
  assert.equal(info.book.chapters[0].title, '第一章 起');
  assert.equal(info.rawBytes, null);
  const gbk = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]).buffer;
  assert.equal((await inspectFile(fakeFile('gbk.txt', '', gbk))).book.content, '中文');
});

test('inspectFile 与 createDocument 端到端解析 EPUB，含目录、清洗与图片内联', async () => {
  const buffer = await makeEpub();
  const { book, rawBytes } = await inspectFile(fakeFile('sample.epub', 'application/epub+zip', buffer));
  assert.equal(book.format, 'epub');
  assert.equal(book.title, '测试电子书 & 更多');
  assert.equal(book.total, 2);
  assert.deepEqual(book.chapters.map((c) => c.title), ['第一章 开始', '第二章 结束']);
  assert.ok(rawBytes instanceof ArrayBuffer);

  const doc = await createDocument(book, rawBytes);
  assert.equal(doc.unit, 'chapter');
  assert.equal(doc.total, 2);
  assert.match(doc.chapters[0].html, /第一段/);
  assert.match(doc.chapters[0].html, /data:image\/png;base64/);
  assert.doesNotMatch(doc.chapters[0].html, /<script|onclick|javascript:/i);
});

test('inspectFile 与 createDocument 端到端解析 PDF，按页生成目录', async () => {
  const buffer = makePdf();
  const { book, rawBytes } = await inspectFile(fakeFile('sample.pdf', 'application/pdf', buffer));
  assert.equal(book.format, 'pdf');
  assert.equal(book.total, 2);
  assert.deepEqual(book.chapters.map((c) => c.title), ['第 1 页', '第 2 页']);
  const doc = await createDocument(book, rawBytes);
  assert.equal(doc.unit, 'page');
  assert.equal(doc.total, 2);
  await doc.dispose();
});

test('inspectFile 与 createDocument 端到端解析真实 CHM 样本', async () => {
  const data = await readFile(join(root, 'tests', 'fixtures', 'sample.chm'));
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const { book, rawBytes } = await inspectFile(fakeFile('sample.chm', 'application/vnd.ms-htmlhelp', buffer));
  assert.equal(book.format, 'chm');
  assert.equal(book.title, '测试手册');
  assert.equal(book.total, 2);
  assert.deepEqual(book.chapters.map((c) => c.title), ['首页', '第一章 开始']);
  const doc = await createDocument(book, rawBytes);
  assert.equal(doc.unit, 'chapter');
  assert.match(doc.chapters[0].html, /测试手册首页/);
  assert.match(doc.chapters[1].html, /中文正文内容/);
});

test('无 .hhc 目录的老式 CHM 靠页面枚举导入，并用页面标题生成目录', async () => {
  const data = await readFile(join(root, 'tests', 'fixtures', 'legacy-no-toc.chm'));
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const { book, rawBytes } = await inspectFile(fakeFile('legacy-no-toc.chm', 'application/vnd.ms-htmlhelp', buffer));
  assert.equal(book.format, 'chm');
  assert.equal(book.title, '老式无目录手册');
  assert.equal(book.total, 3);
  assert.deepEqual(book.chapters.map((c) => c.title), ['第一章 起', '第二章 承', '第十章 转']);

  const doc = await createDocument(book, rawBytes);
  assert.equal(doc.unit, 'chapter');
  assert.match(doc.chapters[0].html, /老式 CHM 第一页正文/);
  assert.match(doc.chapters[2].html, /第十页正文/);
  assert.doesNotMatch(doc.chapters[2].html, /<script/i);
});

test('损坏或被加壳的 CHM 给出明确错误，而不是「没有可阅读的页面」', async () => {
  const broken = new TextEncoder().encode('CB_?~ not a chm').buffer;
  await assert.rejects(
    () => inspectFile(fakeFile('broken.chm', '', broken)),
    /不是有效的 CHM 文件/,
  );
});

test('不支持的格式给出明确错误', async () => {
  await assert.rejects(
    () => inspectFile(fakeFile('a.mobi', '', new ArrayBuffer(1))),
    /不支持的文件类型/,
  );
});
