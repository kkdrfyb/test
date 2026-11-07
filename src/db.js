const DB_NAME = 'jiandu-reader';
const DB_VERSION = 2;
let dbPromise = null;

/** 打开（并缓存）IndexedDB 连接，书籍与设置都存在浏览器本地。 */
export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('当前环境不支持 IndexedDB，请使用现代浏览器打开'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        // 原始文件字节单独存放，避免每次保存进度都重写整本书的二进制内容。
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('数据库升级被其他标签页阻塞，请关闭其他标签页后重试'));
    });
  }
  return dbPromise;
}

function asPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('事务被中止'));
  });
}

export async function getAllBooks() {
  const db = await openDb();
  const tx = db.transaction('books', 'readonly');
  const books = await asPromise(tx.objectStore('books').getAll());
  return books.sort((a, b) => (b.lastReadAt || b.addedAt) - (a.lastReadAt || a.addedAt));
}

export async function getBook(id) {
  const db = await openDb();
  const tx = db.transaction('books', 'readonly');
  return asPromise(tx.objectStore('books').get(id));
}

export async function putBook(book) {
  const db = await openDb();
  const tx = db.transaction('books', 'readwrite');
  tx.objectStore('books').put(book);
  await transactionDone(tx);
  return book;
}

export async function deleteBook(id) {
  const db = await openDb();
  const tx = db.transaction(['books', 'files'], 'readwrite');
  tx.objectStore('books').delete(id);
  tx.objectStore('files').delete(id);
  await transactionDone(tx);
}

export async function putFile(id, data) {
  const db = await openDb();
  const tx = db.transaction('files', 'readwrite');
  tx.objectStore('files').put({ id, data });
  await transactionDone(tx);
}

export async function getFile(id) {
  const db = await openDb();
  const tx = db.transaction('files', 'readonly');
  const record = await asPromise(tx.objectStore('files').get(id));
  return record?.data ?? null;
}

/** 只更新阅读进度相关字段，避免整本书内容被反复写入。 */
export async function saveProgress(id, offset, chapterIndex, percent) {
  const db = await openDb();
  const tx = db.transaction('books', 'readwrite');
  const store = tx.objectStore('books');
  const book = await asPromise(store.get(id));
  if (book) {
    book.offset = offset;
    book.chapterIndex = chapterIndex;
    book.percent = percent;
    book.lastReadAt = Date.now();
    store.put(book);
  }
  await transactionDone(tx);
}

export async function getSettings(fallback) {
  const db = await openDb();
  const tx = db.transaction('meta', 'readonly');
  const record = await asPromise(tx.objectStore('meta').get('prefs'));
  return { ...fallback, ...(record?.value || {}) };
}

export async function saveSettings(value) {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key: 'prefs', value });
  await transactionDone(tx);
}
