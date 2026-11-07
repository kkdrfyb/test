/**
 * 存储适配层：浏览器预览走 IndexedDB，Tauri 桌面窗口走 Rust 书库 IPC。
 *
 * 上层 app.js 只依赖这里导出的一组函数，感知不到两种后端的差异：
 * - 浏览器：导入文件时把整本字节存进 IndexedDB（原有行为）。
 * - 桌面：书架只是路径索引，打开某本书时才按需读取字节并解析目录。
 */
import * as browser from './db.js';
import { inspectFile } from './formats.js';

/** Tauri 在 WebView 里注入 __TAURI_INTERNALS__；打包后的自定义协议也作为兜底判据。 */
export function isDesktop() {
  const win = globalThis.window;
  if (win && typeof win.__TAURI_INTERNALS__?.invoke === 'function') return true;
  return /^(tauri:|https?:\/\/tauri\.localhost)/i.test(globalThis.location?.href || '');
}

/** IPC 的原始字节响应在 WebView 里是 ArrayBuffer；兼容几种常见载体便于测试与降级。 */
export function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value).buffer;
  if (typeof value === 'string') {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  throw new Error('读取书籍失败：Rust 返回的字节格式不受支持');
}

const desktopOnly = (message) => async () => { throw new Error(message); };

const browserBackend = {
  isDesktop: () => false,
  getAllBooks: browser.getAllBooks,
  getBook: browser.getBook,
  getFile: browser.getFile,
  putBook: browser.putBook,
  putFile: browser.putFile,
  deleteBook: browser.deleteBook,
  saveProgress: browser.saveProgress,
  getSettings: browser.getSettings,
  saveSettings: browser.saveSettings,
  libraryRoot: async () => null,
  scanLibrary: desktopOnly('浏览器预览请使用「导入书籍」；扫描书库是桌面客户端功能'),
  pickLibraryDir: async () => null,
};

/**
 * 构造桌面后端；invoke / open / inspect 均可注入，便于在 Node 里做单元测试。
 * 书籍目录解析结果缓存在内存，重复打开同一本不会重新解析整本书。
 */
export function createDesktopBackend({ invoke, open, inspect = inspectFile }) {
  let cache = null;
  const parsed = new Map();

  async function ensure() {
    if (!cache) cache = await invoke('library_state');
    return cache;
  }

  function toView(meta) {
    const progress = cache?.progress?.[meta.id] || {};
    return {
      id: meta.id,
      title: meta.title,
      format: meta.format,
      path: meta.path,
      size: meta.size,
      chapters: [],
      content: '',
      total: 0,
      offset: progress.offset ?? 0,
      chapterIndex: progress.chapterIndex ?? 0,
      percent: progress.percent ?? 0,
      lastReadAt: progress.updatedAt ?? 0,
      addedAt: 0,
    };
  }

  function findMeta(id) {
    return cache?.books?.find((book) => book.id === id) || null;
  }

  async function ensureParsed(meta) {
    if (parsed.has(meta.id)) return parsed.get(meta.id);
    const bytes = toArrayBuffer(await invoke('read_book', { id: meta.id }));
    const fakeFile = {
      name: `${meta.title}.${meta.format}`,
      type: '',
      size: bytes.byteLength,
      arrayBuffer: async () => bytes,
    };
    const { book } = await inspect(fakeFile);
    const result = { book, bytes };
    parsed.set(meta.id, result);
    return result;
  }

  return {
    isDesktop: () => true,

    async getAllBooks() {
      await ensure();
      return cache.books.map(toView).sort((a, b) =>
        (b.lastReadAt || 0) - (a.lastReadAt || 0) || a.title.localeCompare(b.title, 'zh-CN'));
    },

    /** 返回索引元数据 + 打开时解析出的章节/正文，并保留 Rust 侧持久化进度。 */
    async getBook(id) {
      await ensure();
      const meta = findMeta(id);
      if (!meta) return undefined;
      const view = toView(meta);
      const { book } = await ensureParsed(meta);
      return {
        ...view,
        ...book,
        id: meta.id,
        title: meta.title,
        format: meta.format,
        size: meta.size,
        offset: view.offset,
        chapterIndex: view.chapterIndex,
        percent: view.percent,
        lastReadAt: view.lastReadAt,
        addedAt: 0,
      };
    },

    async getFile(id) {
      await ensure();
      const meta = findMeta(id);
      return meta ? (await ensureParsed(meta)).bytes : null;
    },

    async saveProgress(id, offset, chapterIndex, percent) {
      // Tauri 2 会把 Rust 的 snake_case 参数自动映射为 camelCase。
      await invoke('save_progress', { id, offset, chapterIndex, percent });
      await ensure();
      cache.progress = cache.progress || {};
      cache.progress[id] = { offset, chapterIndex, percent, updatedAt: Date.now() };
    },

    async getSettings(fallback) {
      const value = await invoke('get_settings');
      return { ...fallback, ...(value && typeof value === 'object' ? value : {}) };
    },

    async saveSettings(value) {
      await invoke('save_settings', { value });
    },

    async libraryRoot() {
      await ensure();
      return cache?.root || '';
    },

    async scanLibrary(root = '') {
      cache = await invoke('scan_library', { root });
      parsed.clear();
      return cache;
    },

    async pickLibraryDir() {
      const selected = await open({ directory: true, multiple: false, title: '选择书库目录' });
      if (typeof selected === 'string' && selected) return selected;
      if (Array.isArray(selected) && selected[0]) return selected[0];
      return null;
    },

    putBook: desktopOnly('桌面版书籍由书库目录管理，请使用「选择书库目录」'),
    putFile: desktopOnly('桌面版按需读取原始文件，无需导入字节'),
    deleteBook: desktopOnly('桌面版不会删除磁盘上的书；请在书库目录中自行整理'),
  };
}

let backendPromise = null;
function resolveBackend() {
  if (!backendPromise) {
    backendPromise = isDesktop()
      ? import('../vendor/tauri.mjs')
        .then(({ invoke, open }) => createDesktopBackend({ invoke, open }))
        .catch((error) => { backendPromise = null; throw error; })
      : Promise.resolve(browserBackend);
  }
  return backendPromise;
}

const call = async (method, ...args) => (await resolveBackend())[method](...args);

export const getAllBooks = () => call('getAllBooks');
export const getBook = (id) => call('getBook', id);
export const getFile = (id) => call('getFile', id);
export const putBook = (book) => call('putBook', book);
export const putFile = (id, data) => call('putFile', id, data);
export const deleteBook = (id) => call('deleteBook', id);
export const saveProgress = (id, offset, chapterIndex, percent) =>
  call('saveProgress', id, offset, chapterIndex, percent);
export const getSettings = (fallback) => call('getSettings', fallback);
export const saveSettings = (value) => call('saveSettings', value);
export const libraryRoot = () => call('libraryRoot');
export const scanLibrary = (root) => call('scanLibrary', root);
export const pickLibraryDir = () => call('pickLibraryDir');
