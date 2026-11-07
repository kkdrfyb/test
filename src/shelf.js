/**
 * 书架展示相关的纯函数：筛选、排序、单位文案。
 * 单独成模块是为了让 app.js 保持薄，且能在 Node 里直接做单元测试。
 */

export const SORT_OPTIONS = [
  { value: 'recent', label: '最近阅读' },
  { value: 'title', label: '书名' },
  { value: 'progress', label: '阅读进度' },
  { value: 'size', label: '文件大小' },
  { value: 'format', label: '格式' },
];

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const byTitle = (a, b) => collator.compare(a.title || '', b.title || '');
const byId = (a, b) => String(a.id || '').localeCompare(String(b.id || ''));

export function filterBooks(books, keyword = '') {
  const query = keyword.trim().toLowerCase();
  if (!query) return [...books];
  return books.filter((book) => (book.title || '').toLowerCase().includes(query));
}

/** 排序结果即书架「名次」：列表视图直接按数组下标显示第 N 名。 */
export function sortBooks(books, key = 'recent') {
  const list = [...books];
  switch (key) {
    case 'title':
      return list.sort((a, b) => byTitle(a, b) || byId(a, b));
    case 'progress':
      return list.sort((a, b) => (b.percent || 0) - (a.percent || 0) || byTitle(a, b) || byId(a, b));
    case 'size':
      return list.sort((a, b) => (b.size || 0) - (a.size || 0) || byTitle(a, b) || byId(a, b));
    case 'format':
      return list.sort((a, b) =>
        String(a.format || '').localeCompare(String(b.format || '')) || byTitle(a, b) || byId(a, b));
    case 'recent':
    default:
      return list.sort((a, b) =>
        (b.lastReadAt || b.addedAt || 0) - (a.lastReadAt || a.addedAt || 0)
        || byTitle(a, b) || byId(a, b));
  }
}

export function bookUnit(book) {
  if (book.format === 'pdf' && book.total) return `${book.total} 页`;
  if (book.chapters?.length) return `${book.chapters.length} 章`;
  return (book.format || 'txt').toUpperCase();
}
