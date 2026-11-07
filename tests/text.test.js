import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeTxt,
  normalizeText,
  detectChapters,
  computePercent,
  getChapterAt,
  getChapterText,
  splitParagraphs,
} from '../src/text.js';

const utf8 = (text) => new TextEncoder().encode(text);

test('decodeTxt 正确解码带 BOM 的 UTF-8 并统一换行', () => {
  const bytes = utf8('\uFEFF第一章 起\r\n正文\r\n');
  assert.equal(decodeTxt(bytes), '第一章 起\n正文\n');
});

test('decodeTxt 在 UTF-8 解码失败时回退 GBK', () => {
  // GBK 编码的「中文」：D6 D0 CE C4
  const bytes = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a]);
  assert.equal(decodeTxt(bytes), '中文\n');
});

test('decodeTxt 接受 ArrayBuffer', () => {
  const bytes = utf8('正文');
  assert.equal(decodeTxt(bytes.buffer), '正文');
});

test('normalizeText 去掉 BOM、控制字符并统一换行', () => {
  assert.equal(normalizeText('\uFEFFa\r\nb\rc\u0000'), 'a\nb\nc');
});

test('detectChapters 识别中文数字、阿拉伯数字、卷与英文 Chapter 标题', () => {
  const text = [
    '第一章 起始',
    '正文第一段',
    '第2章 风波',
    '正文第二段',
    '卷三 远行',
    '正文第三段',
    'Chapter 4 The End',
    '尾声',
  ].join('\n');
  const chapters = detectChapters(text);
  assert.deepEqual(
    chapters.map((c) => c.title),
    ['第一章 起始', '第2章 风波', '卷三 远行', 'Chapter 4 The End', '尾声'],
  );
  assert.equal(chapters[1].offset, text.indexOf('第2章 风波'));
});

test('detectChapters 忽略普通正文与过长的行', () => {
  const longLine = `第一章 ${'很长'.repeat(40)}`;
  const chapters = detectChapters(`他说第一章只是个开头\n${longLine}\n普通一行文本\n`);
  assert.deepEqual(chapters, []);
});

test('detectChapters 对开头自带的目录去重，只保留正文中的章节', () => {
  const text = ['目录', '第一章 起始', '第2章 风波', '正文', '第一章 起始', '内容', '第2章 风波', '内容'].join('\n');
  const chapters = detectChapters(text);
  assert.deepEqual(chapters.map((c) => c.title), ['第一章 起始', '第2章 风波']);
  assert.equal(chapters[0].offset, text.lastIndexOf('第一章 起始'));
});

test('detectChapters 无章节时返回空数组', () => {
  assert.deepEqual(detectChapters('一段纯文本\n另一段纯文本'), []);
});

test('computePercent 处理零值、越界与小数精度', () => {
  assert.equal(computePercent(0, 10), 0);
  assert.equal(computePercent(200, 0), 0);
  assert.equal(computePercent(200, 50), 25);
  assert.equal(computePercent(200, 500), 100);
  assert.equal(computePercent(3, 1), 33.3);
  assert.equal(computePercent(200, Number.NaN), 0);
});

test('getChapterAt 按偏移返回所在章节', () => {
  const chapters = [{ title: 'A', offset: 0 }, { title: 'B', offset: 100 }, { title: 'C', offset: 200 }];
  assert.equal(getChapterAt(chapters, 0), 0);
  assert.equal(getChapterAt(chapters, 99), 0);
  assert.equal(getChapterAt(chapters, 100), 1);
  assert.equal(getChapterAt(chapters, 999), 2);
  assert.equal(getChapterAt([], 50), 0);
});

test('getChapterText 正确切片，无章节时退化为全文', () => {
  const text = '前言内容\n第一章 甲\n甲的正文\n第2章 乙\n乙的正文';
  const chapters = detectChapters(text);
  assert.deepEqual(getChapterText(text, [], 0), { title: '全文', text, start: 0 });
  const first = getChapterText(text, chapters, 0);
  assert.equal(first.title, '第一章 甲');
  assert.equal(first.text, '第一章 甲\n甲的正文\n');
  const second = getChapterText(text, chapters, 1);
  assert.equal(second.text, '第2章 乙\n乙的正文');
  assert.equal(second.start, text.indexOf('第2章 乙'));
});

test('splitParagraphs 过滤空行但保留段落内容', () => {
  assert.deepEqual(splitParagraphs('第一段\n\n  第二段  \n\n\n第三段\n'), ['第一段', '  第二段', '第三段']);
});
