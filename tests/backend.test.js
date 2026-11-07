import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDesktopBackend,
  isDesktop,
  toArrayBuffer,
  getAllBooks,
} from '../src/backend.js';

const sampleData = {
  version: 1,
  root: 'D:/books',
  books: [
    { id: 'a', title: '阿Q正传', format: 'chm', path: 'D:/books/阿Q正传.chm', size: 1024, modifiedAt: 1 },
    { id: 'b', title: '1984', format: 'epub', path: 'D:/books/1984.epub', size: 2048, modifiedAt: 2 },
  ],
  progress: { a: { offset: 3.5, chapterIndex: 2, percent: 42, updatedAt: 1000 } },
};

function makeDesktop(options = {}) {
  const calls = [];
  const bytes = new TextEncoder().encode('CHM-BYTES').buffer;
  const invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    switch (cmd) {
      case 'library_state': return structuredClone(sampleData);
      case 'read_book': return bytes;
      case 'scan_library': return { ...structuredClone(sampleData), root: args.root || sampleData.root };
      case 'get_settings': return { theme: 'dark', fontSize: 20 };
      case 'save_progress':
      case 'save_settings': return null;
      default: throw new Error(`意外的命令：${cmd}`);
    }
  };
  const inspect = async (file) => ({
    book: {
      format: 'chm', title: '解析出的内部标题', size: file.size,
      chapters: [{ title: '第一章' }, { title: '第二章' }],
      content: '', total: 2, offset: 0, chapterIndex: 0, percent: 0, lastReadAt: 0,
    },
  });
  const open = async () => (Object.hasOwn(options, 'picked') ? options.picked : 'D:/new-books');
  return { backend: createDesktopBackend({ invoke, open, inspect }), calls, bytes, open };
}

test('toArrayBuffer 兼容 IPC 原始字节的多种载体', () => {
  const bytes = Uint8Array.from([1, 2, 3]);
  assert.equal(new Uint8Array(toArrayBuffer(bytes.buffer))[2], 3);
  assert.deepEqual([...new Uint8Array(toArrayBuffer(Uint8Array.from([4, 5])))], [4, 5]);
  assert.deepEqual([...new Uint8Array(toArrayBuffer([6, 7]))], [6, 7]);
  assert.deepEqual([...new Uint8Array(toArrayBuffer('CA=='))], [8]);
  assert.throws(() => toArrayBuffer({}), /字节格式不受支持/);
});

test('isDesktop 识别 Tauri 注入对象与自定义协议，普通浏览器为 false', () => {
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.location;
  try {
    globalThis.window = undefined;
    globalThis.location = undefined;
    assert.equal(isDesktop(), false);
    globalThis.window = { __TAURI_INTERNALS__: { invoke: () => {} } };
    assert.equal(isDesktop(), true);
    globalThis.window = undefined;
    globalThis.location = { href: 'http://tauri.localhost/' };
    assert.equal(isDesktop(), true);
    globalThis.location = { href: 'http://localhost:5173/' };
    assert.equal(isDesktop(), false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
  }
});

test('getAllBooks 把 Rust 索引与进度合成为书架视图并按最近阅读排序', async () => {
  const { backend, calls } = makeDesktop();
  const books = await backend.getAllBooks();
  assert.equal(books[0].id, 'a', '有阅读进度的书应排在前面');
  assert.equal(books[0].title, '阿Q正传');
  assert.equal(books[0].format, 'chm');
  assert.equal(books[0].offset, 3.5);
  assert.equal(books[0].chapterIndex, 2);
  assert.equal(books[0].percent, 42);
  assert.equal(books[0].lastReadAt, 1000);
  assert.equal(books[1].offset, 0);
  assert.deepEqual(books[1].chapters, [], '书架列表不应触发整本解析');
  assert.equal(calls.filter((call) => call.cmd === 'read_book').length, 0);
});

test('getBook 合并解析结果但保留持久化进度与索引书名', async () => {
  const { backend } = makeDesktop();
  const book = await backend.getBook('a');
  assert.equal(book.id, 'a');
  assert.equal(book.title, '阿Q正传', '不能用书内标题覆盖索引书名');
  assert.equal(book.chapters.length, 2);
  assert.equal(book.total, 2);
  assert.equal(book.offset, 3.5, '解析结果的 offset=0 不能覆盖已保存进度');
  assert.equal(book.percent, 42);
  assert.equal(await backend.getBook('missing'), undefined);
});

test('getFile 复用缓存，打开同一本书不会重复读取原始字节', async () => {
  const { backend, calls, bytes } = makeDesktop();
  assert.equal(await backend.getFile('a'), bytes);
  assert.equal(await backend.getFile('a'), bytes);
  await backend.getBook('a');
  assert.equal(calls.filter((call) => call.cmd === 'read_book').length, 1);
  assert.equal(await backend.getFile('missing'), null);
});

test('saveProgress 以 camelCase 参数调用 Rust 并同步本地缓存', async () => {
  const { backend, calls } = makeDesktop();
  await backend.saveProgress('a', 8.25, 4, 76);
  const call = calls.find((entry) => entry.cmd === 'save_progress');
  assert.deepEqual(call.args, { id: 'a', offset: 8.25, chapterIndex: 4, percent: 76 },
    'Tauri 2 自动把 chapter_index 映射为 chapterIndex');
  const refreshed = await backend.getAllBooks();
  assert.equal(refreshed.find((b) => b.id === 'a').percent, 76, '未重扫也应看到新进度');
});

test('阅读设置从 Rust 读取并与默认值合并', async () => {
  const { backend, calls } = makeDesktop();
  assert.deepEqual(await backend.getSettings({ theme: 'light', lineHeight: 1.8 }), {
    theme: 'dark', lineHeight: 1.8, fontSize: 20,
  });
  await backend.saveSettings({ theme: 'sepia' });
  assert.deepEqual(calls.find((c) => c.cmd === 'save_settings').args, { value: { theme: 'sepia' } });
});

test('scanLibrary 更新根目录并清空解析缓存', async () => {
  const { backend, calls } = makeDesktop();
  await backend.getFile('a');
  assert.equal(await backend.libraryRoot(), 'D:/books');
  const data = await backend.scanLibrary('D:/new-books');
  assert.equal(data.root, 'D:/new-books');
  assert.equal(await backend.libraryRoot(), 'D:/new-books');
  await backend.getFile('a');
  assert.equal(calls.filter((call) => call.cmd === 'read_book').length, 2, '换目录后必须重新读文件');
  assert.deepEqual(calls.find((c) => c.cmd === 'scan_library').args, { root: 'D:/new-books' });
});

test('pickLibraryDir 处理单选、数组与取消三种返回', async () => {
  assert.equal(await makeDesktop({ picked: 'D:/picked' }).backend.pickLibraryDir(), 'D:/picked');
  assert.equal(await makeDesktop({ picked: ['D:/array'] }).backend.pickLibraryDir(), 'D:/array');
  assert.equal(await makeDesktop({ picked: null }).backend.pickLibraryDir(), null);
});

test('桌面模式禁止写入/删除操作，避免改动磁盘上的原书', async () => {
  const { backend } = makeDesktop();
  await assert.rejects(() => backend.putBook({}), /书库目录管理/);
  await assert.rejects(() => backend.putFile('a', new ArrayBuffer(1)), /按需读取/);
  await assert.rejects(() => backend.deleteBook('a'), /不会删除磁盘/);
});

test('无 Tauri 环境时模块级接口仍走浏览器 IndexedDB 分支', async () => {
  await assert.rejects(() => getAllBooks(), /IndexedDB/);
});
