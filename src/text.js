const CHAPTER_PATTERNS = [
  /^\s*(第\s*[零一二三四五六七八九十百千两0-9０-９]+\s*[章回卷篇部集节]\s*[^\n]{0,40}?)\s*$/,
  /^\s*(卷\s*[零一二三四五六七八九十百千两0-9０-９]+\s*[^\n]{0,40}?)\s*$/,
  /^\s*(Chapter\s+\d+\s*[^\n]{0,40}?)\s*$/i,
  /^\s*(序章|楔子|序言|引子|尾声|后记|番外|终章)\s*[^\n]{0,20}?\s*$/,
];

const MAX_CHAPTERS = 2000;

/**
 * 把 TXT 文件的原始字节解码为字符串。
 * 优先按 UTF-8 严格解码，失败则回退 GBK（兼容老式中文 TXT）。
 */
export function decodeTxt(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('gbk').decode(bytes);
  }
  return normalizeText(text);
}

/** 统一换行、去掉 BOM 与控制字符，避免渲染和偏移计算出现偏差。 */
export function normalizeText(text) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** 按行扫描，识别常见中英文章节标题，返回 { title, offset } 列表。 */
export function detectChapters(text) {
  const source = normalizeText(text);
  const chapters = [];
  let offset = 0;
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && trimmed.length <= 50) {
      for (const pattern of CHAPTER_PATTERNS) {
        const match = trimmed.match(pattern);
        if (match) {
          chapters.push({ title: match[1].trim(), offset });
          break;
        }
      }
    }
    offset += line.length + 1;
  }
  // 章节数量异常（例如正文里大量编号行）时不生成目录，退化为单章全文。
  if (chapters.length > MAX_CHAPTERS) return [];
  // 很多 TXT 小说开头自带目录：同名标题只保留最后一次出现（即正文里的真实章节）。
  const lastByTitle = new Map();
  for (const chapter of chapters) lastByTitle.set(chapter.title, chapter);
  return chapters.filter((chapter) => lastByTitle.get(chapter.title) === chapter);
}

/** 把字符偏移换算成阅读百分比，保留一位小数，结果恒在 0~100 之间。 */
export function computePercent(total, offset) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  const percent = (offset / total) * 100;
  return Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10;
}

/** 返回偏移所在的章节序号；无章节或位于第一章之前时返回 0。 */
export function getChapterAt(chapters, offset) {
  if (!Array.isArray(chapters) || chapters.length === 0) return 0;
  let index = 0;
  for (let i = 0; i < chapters.length; i += 1) {
    if (chapters[i].offset <= offset) index = i;
    else break;
  }
  return index;
}

/** 把一段正文切成段落，过滤空行并保留段首缩进语义。 */
export function splitParagraphs(text) {
  return normalizeText(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

/** 取某一章的正文（不含下一章标题行本身）。 */
export function getChapterText(text, chapters, index) {
  const source = normalizeText(text);
  if (!Array.isArray(chapters) || chapters.length === 0) return { title: '全文', text: source, start: 0 };
  const safeIndex = Math.min(Math.max(0, index), chapters.length - 1);
  const chapter = chapters[safeIndex];
  const next = chapters[safeIndex + 1];
  return {
    title: chapter.title,
    text: source.slice(chapter.offset, next ? next.offset : source.length),
    start: chapter.offset,
  };
}
