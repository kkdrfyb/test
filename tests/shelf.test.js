import test from 'node:test';
import assert from 'node:assert/strict';
import { SORT_OPTIONS, filterBooks, sortBooks, bookUnit } from '../src/shelf.js';

const books = [
  { id: 'a', title: '阿Q正传', format: 'chm', size: 1024, percent: 20, lastReadAt: 100 },
  { id: 'b', title: '1984', format: 'pdf', size: 4096, percent: 80, lastReadAt: 300, total: 12 },
  { id: 'c', title: '第10章', format: 'epub', size: 2048, percent: 0, lastReadAt: 0 },
  { id: 'd', title: '第2章', format: 'txt', size: 512, percent: 50, lastReadAt: 200, chapters: [{}, {}] },
];

test('排序下拉包含五种排序方式', () => {
  assert.deepEqual(SORT_OPTIONS.map((option) => option.value),
    ['recent', 'title', 'progress', 'size', 'format']);
});

test('筛选按书名包含匹配、忽略大小写与首尾空格且不改原数组', () => {
  assert.deepEqual(filterBooks(books, '  1984  ').map((b) => b.id), ['b']);
  assert.deepEqual(filterBooks(books, '第').map((b) => b.id), ['c', 'd']);
  assert.deepEqual(filterBooks(books, '  '), books);
  assert.equal(books.length, 4, '筛选不得修改传入数组');
});

test('最近阅读按时间倒序，未读书排最后', () => {
  assert.deepEqual(sortBooks(books, 'recent').map((b) => b.id), ['b', 'd', 'a', 'c']);
  assert.deepEqual(sortBooks(books, 'unknown').map((b) => b.id),
    sortBooks(books, 'recent').map((b) => b.id), '未知排序键回退到最近阅读');
});

test('书名排序中文与数字感知，进度/大小/格式排序稳定', () => {
  assert.deepEqual(sortBooks(books, 'title').map((b) => b.id), ['b', 'a', 'd', 'c']);
  assert.deepEqual(sortBooks(books, 'progress').map((b) => b.id), ['b', 'd', 'a', 'c']);
  assert.deepEqual(sortBooks(books, 'size').map((b) => b.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(sortBooks(books, 'format').map((b) => b.id), ['a', 'c', 'b', 'd']);
  assert.deepEqual(books.map((b) => b.id), ['a', 'b', 'c', 'd'], '排序不得修改传入数组');
});

test('单位文案按格式与结构选择页/章/格式', () => {
  assert.equal(bookUnit(books[1]), '12 页');
  assert.equal(bookUnit(books[3]), '2 章');
  assert.equal(bookUnit(books[0]), 'CHM');
  assert.equal(bookUnit({ format: 'pdf' }), 'PDF');
});
