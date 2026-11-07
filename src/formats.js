import {
  JSZip,
  pdfjsLib,
  ChmFile,
  chmReaderFromBuffer,
  parseSystemInfo,
  parseToc,
  ChmEnumerateFlags,
} from '../vendor/books.mjs';
import {
  decodeTxt,
  detectChapters,
  getChapterText,
  splitParagraphs,
  normalizeText,
} from './text.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.mjs', import.meta.url).href;

export const SUPPORTED_EXTENSIONS = ['txt', 'epub', 'pdf', 'chm'];
export const ACCEPT_ATTR = '.txt,.epub,.pdf,.chm,text/plain,application/epub+zip,application/pdf,application/vnd.ms-htmlhelp';

/** 按扩展名识别格式，扩展名缺失时再参考 MIME。 */
export function detectFormat(name = '', mime = '') {
  const ext = String(name).toLowerCase().split('.').pop();
  if (SUPPORTED_EXTENSIONS.includes(ext)) return ext;
  if (/epub\+zip/.test(mime)) return 'epub';
  if (/pdf/.test(mime)) return 'pdf';
  if (/htmlhelp|chm/.test(mime)) return 'chm';
  if (/text\/plain/.test(mime)) return 'txt';
  return null;
}

export const fileTitle = (name) => String(name).replace(/\.[^.]+$/, '');

/* ------------------------- 通用纯函数（可单测） ------------------------- */

export function decodeEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&amp;|&lt;|&gt;|&quot;|&apos;|&#39;|&nbsp;/g, (entity) => ({
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
      '&apos;': "'", '&#39;': "'", '&nbsp;': ' ',
    })[entity]);
}

export function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

const getAttr = (tag, name) => {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(["'])([^"']*)\\1`, 'i'));
  return match ? decodeEntities(match[2]) : null;
};

export function parseContainerXml(xml) {
  const tag = String(xml).match(/<rootfile\b[^>]*>/i);
  return tag ? getAttr(tag[0], 'full-path') : null;
}

/** 解析 EPUB 的 .opf：书名、manifest、spine 阅读顺序、目录文件位置。 */
export function parseOpf(xml) {
  const source = String(xml);
  const items = new Map();
  for (const tag of source.matchAll(/<item\b[^>]*>/gi)) {
    const id = getAttr(tag[0], 'id');
    const href = getAttr(tag[0], 'href');
    if (id && href) items.set(id, { href, properties: getAttr(tag[0], 'properties') || '' });
  }
  const spine = [...source.matchAll(/<itemref\b[^>]*>/gi)]
    .map((m) => getAttr(m[0], 'idref'))
    .map((idref) => items.get(idref)?.href)
    .filter(Boolean);
  const nav = [...items.values()].find((item) => /(^|\s)nav(\s|$)/.test(item.properties));
  const tocId = source.match(/<spine\b[^>]*toc\s*=\s*(["'])([^"']*)\1/i)?.[2];
  const titleTag = source.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i);
  return {
    title: titleTag ? stripTags(titleTag[1]) : '',
    spine,
    navHref: nav?.href || null,
    ncxHref: tocId ? items.get(tocId)?.href || null : null,
    items,
  };
}

/** EPUB3 nav.xhtml 与 EPUB2 toc.ncx 都归一化为 [{title, href}]。 */
export function parseNavHtml(html) {
  return [...String(html).matchAll(/<a\b[^>]*href\s*=\s*(["'])([^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ title: stripTags(m[3]), href: decodeEntities(m[2]) }))
    .filter((entry) => entry.title && entry.href);
}

export function parseNcx(xml) {
  return [...String(xml).matchAll(/<navPoint\b[\s\S]*?<\/navPoint>/gi)]
    .map((block) => {
      const label = block[0].match(/<navLabel\b[^>]*>([\s\S]*?)<\/navLabel>/i);
      const content = block[0].match(/<content\b[^>]*src\s*=\s*(["'])([^"']*)\1/i);
      const title = label ? stripTags(label[1]) : '';
      return title && content ? { title, href: decodeEntities(content[2]) } : null;
    })
    .filter(Boolean);
}

/** 把压缩包内的相对路径解析成 zip 内的规范路径。 */
export function resolveZipPath(baseDir, href) {
  const clean = String(href).split('#')[0].split('?')[0].replace(/\\/g, '/');
  const external = /^[a-z]+:/i.test(clean);
  const combined = external ? '' : clean.startsWith('/') ? clean.slice(1) : `${baseDir || ''}${clean}`;
  const parts = [];
  for (const part of combined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return decodeURIComponent(parts.join('/'));
}

/** 把 CHM 目录树压平为 [{title, local}]，保留层级缩进信息。 */
export function flattenToc(entries, depth = 0) {
  const flat = [];
  for (const entry of entries || []) {
    flat.push({ title: entry.name || '未命名', local: entry.local || '', depth });
    if (entry.children?.length) flat.push(...flattenToc(entry.children, depth + 1));
  }
  return flat;
}

export function normalizeChmPath(href, base = '') {
  let path = String(href || '').split('#')[0].split('?')[0].replace(/\\/g, '/');
  try { path = decodeURIComponent(path); } catch { /* 保留原始路径 */ }
  if (/^[a-z]+:/i.test(path)) return path;
  const dir = base.startsWith('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  const combined = path.startsWith('/') ? path : `${dir}${path}`;
  const parts = [];
  for (const part of combined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/** CHM 里的 HTML 常见 GBK/GB18030，优先按 UTF-8 严格解码再回退。 */
export function decodeChmText(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    text = new TextDecoder('gb18030').decode(data);
  }
  return normalizeText(text);
}

/** 移除脚本、外链资源与事件属性；书籍内容属于不可信输入，必须清洗后再写入 DOM。 */
export function sanitizeHtml(html) {
  let body = String(html).match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? String(html);
  body = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<(embed|meta|base|form)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\ssrcdoc\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(/\s(href|src|action)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, ' $1="#"');
  return body.trim();
}

const mimeFromExt = (path) => ({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp',
}[String(path).toLowerCase().split('.').pop()] || 'application/octet-stream');

function bytesToDataUrl(bytes, mime) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** 把章节里的相对图片路径替换为 data URL，避免 EPUB/CHM 离线时图片加载失败。 */
export async function inlineImages(html, resolveAsset) {
  const matches = [...String(html).matchAll(/\bsrc\s*=\s*(["'])([^"']+)\1/gi)];
  let result = String(html);
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i];
    const src = decodeEntities(match[2]);
    if (/^(data:|https?:|blob:|#)/i.test(src)) continue;
    const asset = await resolveAsset(src.split('#')[0].split('?')[0]);
    if (asset) result = `${result.slice(0, match.index)}src="${asset}"${result.slice(match.index + match[0].length)}`;
  }
  return result;
}

/* ------------------------------ 格式加载 ------------------------------ */

async function loadEpub(buffer, fallbackTitle) {
  const zip = await JSZip.loadAsync(buffer);
  const container = zip.file('META-INF/container.xml');
  if (!container) throw new Error('不是有效的 EPUB：缺少 META-INF/container.xml');
  const opfPath = parseContainerXml(await container.async('string'));
  const opfFile = opfPath && zip.file(opfPath);
  if (!opfFile) throw new Error('EPUB 的 OPF 文件缺失或路径无效');
  const opf = parseOpf(await opfFile.async('string'));
  const baseDir = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);

  let toc = [];
  if (opf.navHref) {
    const navFile = zip.file(resolveZipPath(baseDir, opf.navHref));
    if (navFile) toc = parseNavHtml(await navFile.async('string'));
  }
  if (!toc.length && opf.ncxHref) {
    const ncxFile = zip.file(resolveZipPath(baseDir, opf.ncxHref));
    if (ncxFile) toc = parseNcx(await ncxFile.async('string'));
  }

  const spine = opf.spine.length
    ? opf.spine
    : [...opf.items.values()].map((item) => item.href).filter((href) => /\.(x?html?|htm)$/i.test(href));

  const assetLoader = async (src, chapterPath) => {
    const path = resolveZipPath(chapterPath.slice(0, chapterPath.lastIndexOf('/') + 1), src);
    const file = zip.file(path) || zip.file(resolveZipPath(baseDir, src));
    if (!file) return null;
    return bytesToDataUrl(await file.async('uint8array'), mimeFromExt(path));
  };

  const chapters = [];
  for (let index = 0; index < spine.length; index += 1) {
    const href = spine[index];
    const path = resolveZipPath(baseDir, href);
    const file = zip.file(path);
    const raw = file ? await file.async('string') : '';
    const html = await inlineImages(sanitizeHtml(raw), (src) => assetLoader(src, path));
    const baseName = href.split('#')[0].split('/').pop();
    const title = toc.find((entry) => entry.href.split('#')[0].split('/').pop() === baseName)?.title;
    chapters.push({ title: title || `第 ${index + 1} 节`, html });
  }
  if (!chapters.length) throw new Error('EPUB 中没有找到可阅读的章节');
  return { title: opf.title || fallbackTitle, chapters, total: chapters.length };
}

async function loadChm(buffer, fallbackTitle) {
  const chm = await ChmFile.open(chmReaderFromBuffer(new Uint8Array(buffer)));
  const systemRaw = await chm.getSystemRaw();
  const info = systemRaw ? parseSystemInfo(systemRaw) : {};

  let entries = [];
  if (info.tocFile) {
    const tocUnit = await chm.resolve(normalizeChmPath(info.tocFile));
    if (tocUnit) {
      const hhc = decodeChmText(await chm.retrieve(tocUnit));
      entries = flattenToc(parseToc(hhc).entries).filter((entry) => entry.local);
    }
  }
  if (!entries.length) {
    for await (const entry of chm.enumerate(ChmEnumerateFlags.Files)) {
      if (/\.(x?html?|htm)$/i.test(entry.path)) {
        entries.push({ title: entry.path.split('/').pop(), local: entry.path, depth: 0 });
      }
    }
  }

  const assetLoader = async (src, pagePath) => {
    const unit = await chm.resolve(normalizeChmPath(src, pagePath));
    if (!unit) return null;
    return bytesToDataUrl(await chm.retrieve(unit), mimeFromExt(src));
  };

  const chapters = [];
  for (const entry of entries.slice(0, 2000)) {
    const path = normalizeChmPath(entry.local);
    const unit = await chm.resolve(path);
    const html = unit
      ? await inlineImages(sanitizeHtml(decodeChmText(await chm.retrieve(unit))), (src) => assetLoader(src, path))
      : '';
    chapters.push({ title: `${'　'.repeat(Math.min(entry.depth, 4))}${entry.title}`, html });
  }
  if (!chapters.length) throw new Error('CHM 中没有找到可阅读的页面');
  return { title: info.title || fallbackTitle, chapters, total: chapters.length };
}

/** pdf.js v6 把销毁入口放到了 loadingTask 上，旧版则在 document 上。 */
export function destroyPdf(pdf) {
  if (typeof pdf?.loadingTask?.destroy === 'function') return pdf.loadingTask.destroy();
  if (typeof pdf?.destroy === 'function') return pdf.destroy();
  return Promise.resolve();
}

/** 用 PDF 大纲给页码补标题，目录本身始终按页组织，翻页行为可预期。 */
async function pdfPageTitles(pdf) {
  const titles = new Map();
  try {
    const outline = await pdf.getOutline();
    const walk = async (items) => {
      for (const item of items || []) {
        let dest = item.dest;
        if (typeof dest === 'string') dest = await pdf.getDestination(dest);
        const ref = Array.isArray(dest) ? dest[0] : null;
        if (ref) {
          const index = await pdf.getPageIndex(ref);
          if (!titles.has(index + 1)) titles.set(index + 1, stripTags(item.title));
        }
        if (item.items?.length) await walk(item.items);
      }
    };
    await walk(outline);
  } catch { /* 大纲损坏或不存在时按纯页码显示 */ }
  return titles;
}

async function loadPdf(buffer) {
  // pdf.js 会把传入的 ArrayBuffer 转移给 worker 并 detach 原对象；先复制一份，
  // 保证同一份文件字节后续还能再次打开（IndexedDB 中的原始数据不受影响）。
  const data = new Uint8Array(buffer).slice();
  const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  const total = pdf.numPages;
  const titles = await pdfPageTitles(pdf);
  const chapters = Array.from({ length: total }, (_, index) => ({
    title: `第 ${index + 1} 页${titles.has(index + 1) ? ` · ${titles.get(index + 1)}` : ''}`,
  }));
  return { pdf, chapters, total };
}

function textDocument(book) {
  return {
    format: 'txt',
    unit: 'char',
    chapters: book.chapters || [],
    total: book.content.length,
    async render(container, index) {
      const chapter = getChapterText(book.content, book.chapters || [], index);
      const inner = document.createElement('div');
      inner.className = 'content-inner';
      const heading = document.createElement('h2');
      heading.textContent = chapter.title;
      inner.append(heading);
      const paragraphs = splitParagraphs(chapter.text);
      if (paragraphs[0]?.trim() === chapter.title) paragraphs.shift();
      for (const line of paragraphs) {
        const p = document.createElement('p');
        p.textContent = line;
        inner.append(p);
      }
      container.replaceChildren(inner);
    },
  };
}

function htmlDocument(format, parsed) {
  return {
    format,
    unit: 'chapter',
    chapters: parsed.chapters,
    total: parsed.total,
    async render(container, index) {
      const chapter = parsed.chapters[index] || { title: '', html: '' };
      const inner = document.createElement('div');
      inner.className = 'content-inner rich-content';
      inner.innerHTML = `<h2></h2><article>${chapter.html}</article>`;
      inner.querySelector('h2').textContent = chapter.title;
      container.replaceChildren(inner);
    },
  };
}

function pdfDocument(parsed) {
  let currentTask = null;
  return {
    format: 'pdf',
    unit: 'page',
    chapters: parsed.chapters,
    total: parsed.total,
    async render(container, index, { scale = 1.2 } = {}) {
      if (currentTask) {
        currentTask.cancel();
        currentTask = null;
      }
      const page = await parsed.pdf.getPage(index + 1);
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const inner = document.createElement('div');
      inner.className = 'content-inner pdf-page';
      inner.append(canvas);
      container.replaceChildren(inner);
      currentTask = page.render({
        canvas,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await currentTask.promise;
      currentTask = null;
    },
    dispose() {
      if (currentTask) currentTask.cancel();
      return destroyPdf(parsed.pdf);
    },
  };
}

/** 统一的文档对象：chapters / total / unit / render(container, index, options)。 */
export async function createDocument(book, rawBytes) {
  switch (book.format) {
    case 'txt':
      return textDocument(book);
    case 'epub':
      return htmlDocument('epub', await loadEpub(rawBytes, book.title));
    case 'chm':
      return htmlDocument('chm', await loadChm(rawBytes, book.title));
    case 'pdf':
      return pdfDocument(await loadPdf(rawBytes));
    default:
      throw new Error(`暂不支持的格式：${book.format}`);
  }
}

/** 导入时解析出元数据与目录；TXT 额外返回正文，其余返回原始字节由 db 单独存储。 */
export async function inspectFile(file) {
  const format = detectFormat(file.name, file.type);
  if (!format) throw new Error(`不支持的文件类型：${file.name}`);
  const buffer = await file.arrayBuffer();
  const base = {
    format,
    title: fileTitle(file.name),
    size: file.size,
    addedAt: Date.now(),
    lastReadAt: Date.now(),
    offset: 0,
    chapterIndex: 0,
    percent: 0,
  };
  if (format === 'txt') {
    const content = decodeTxt(buffer);
    if (!content.trim()) throw new Error(`${file.name} 是空文件`);
    return { book: { ...base, content, chapters: detectChapters(content) }, rawBytes: null };
  }
  const parsed = format === 'epub' ? await loadEpub(buffer, base.title)
    : format === 'chm' ? await loadChm(buffer, base.title)
      : await loadPdf(buffer);
  if (format === 'pdf') await destroyPdf(parsed.pdf);
  return {
    book: {
      ...base,
      title: parsed.title || base.title,
      content: '',
      chapters: parsed.chapters.map(({ title }) => ({ title })),
      total: parsed.total,
    },
    rawBytes: buffer,
  };
}
