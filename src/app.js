import {
  decodeTxt,
  detectChapters,
  computePercent,
  getChapterAt,
  getChapterText,
  splitParagraphs,
} from './text.js';
import {
  getAllBooks,
  getBook,
  putBook,
  deleteBook,
  saveProgress,
  getSettings,
  saveSettings,
} from './db.js';

const DEFAULTS = { fontSize: 18, lineHeight: 1.8, pageWidth: 760, theme: 'light' };
const $ = (id) => document.getElementById(id);

const els = {
  shelfView: $('shelfView'), readerView: $('readerView'),
  importBtn: $('importBtn'), fileInput: $('fileInput'), dropZone: $('dropZone'),
  bookList: $('bookList'), bookCount: $('bookCount'), emptyState: $('emptyState'),
  backBtn: $('backBtn'), readerBookTitle: $('readerBookTitle'),
  tocBtn: $('tocBtn'), settingsBtn: $('settingsBtn'),
  tocPanel: $('tocPanel'), tocList: $('tocList'), tocCloseBtn: $('tocCloseBtn'),
  settingsPanel: $('settingsPanel'), settingsCloseBtn: $('settingsCloseBtn'),
  themeSelect: $('themeSelect'), fontSizeRange: $('fontSizeRange'),
  lineHeightRange: $('lineHeightRange'), pageWidthRange: $('pageWidthRange'),
  fontSizeValue: $('fontSizeValue'), lineHeightValue: $('lineHeightValue'),
  pageWidthValue: $('pageWidthValue'), resetSettingsBtn: $('resetSettingsBtn'),
  content: $('content'), chapterLabel: $('chapterLabel'),
  percentLabel: $('percentLabel'), progressFill: $('progressFill'),
  prevChapterBtn: $('prevChapterBtn'), nextChapterBtn: $('nextChapterBtn'),
  toast: $('toast'),
};

const state = {
  books: [],
  current: null,
  chapterIndex: 0,
  settings: { ...DEFAULTS },
  saveTimer: null,
  toastTimer: null,
};

const makeId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
}

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ts) {
  if (!ts) return '未读';
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function applySettings() {
  const s = state.settings;
  document.body.dataset.theme = s.theme;
  els.content.style.setProperty('--font-size', `${s.fontSize}px`);
  els.content.style.setProperty('--line-height', String(s.lineHeight));
  els.content.style.setProperty('--page-width', `${s.pageWidth}px`);
  els.themeSelect.value = s.theme;
  els.fontSizeRange.value = String(s.fontSize);
  els.lineHeightRange.value = String(s.lineHeight);
  els.pageWidthRange.value = String(s.pageWidth);
  els.fontSizeValue.textContent = `${s.fontSize}px`;
  els.lineHeightValue.textContent = String(s.lineHeight);
  els.pageWidthValue.textContent = `${s.pageWidth}px`;
}

function scheduleSettingsSave() {
  clearTimeout(state.settingsTimer);
  state.settingsTimer = setTimeout(() => { saveSettings(state.settings).catch(showError); }, 200);
}

function showError(error) {
  console.error(error);
  toast(`出错：${error?.message || error}`);
}

/* ------------------------------ 书架 ------------------------------ */

async function refreshShelf() {
  state.books = await getAllBooks();
  els.bookCount.textContent = `共 ${state.books.length} 本`;
  els.emptyState.hidden = state.books.length > 0;
  els.bookList.replaceChildren();
  for (const book of state.books) {
    const card = document.createElement('div');
    card.className = 'book-card';
    card.addEventListener('click', () => openBook(book.id).catch(showError));

    const name = document.createElement('div');
    name.className = 'book-name';
    name.textContent = book.title;

    const meta = document.createElement('div');
    meta.className = 'book-meta';
    meta.textContent = `${formatSize(book.size)} · ${book.chapters?.length || 0} 章 · ${formatDate(book.lastReadAt)}`;

    const bar = document.createElement('div');
    bar.className = 'book-progress';
    const fill = document.createElement('div');
    fill.style.width = `${book.percent || 0}%`;
    bar.append(fill);

    const foot = document.createElement('div');
    foot.className = 'book-foot';
    const percent = document.createElement('span');
    percent.className = 'book-meta';
    percent.textContent = `已读 ${book.percent || 0}%`;
    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.type = 'button';
    del.textContent = '删除';
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!window.confirm(`确定从书架移除《${book.title}》吗？`)) return;
      deleteBook(book.id).then(refreshShelf).catch(showError);
    });
    foot.append(percent, del);
    card.append(name, meta, bar, foot);
    els.bookList.append(card);
  }
}

async function handleFiles(files) {
  const txts = [...files].filter((f) => /\.txt$/i.test(f.name) || f.type === 'text/plain');
  if (txts.length === 0) {
    toast('请选择 .txt 文本文件');
    return;
  }
  let imported = 0;
  for (const file of txts) {
    try {
      const content = decodeTxt(await file.arrayBuffer());
      if (!content.trim()) {
        toast(`《${file.name}》是空文件，已跳过`);
        continue;
      }
      await putBook({
        id: makeId(),
        title: file.name.replace(/\.txt$/i, ''),
        size: file.size,
        addedAt: Date.now(),
        lastReadAt: Date.now(),
        content,
        chapters: detectChapters(content),
        offset: 0,
        chapterIndex: 0,
        percent: 0,
      });
      imported += 1;
    } catch (error) {
      showError(error);
    }
  }
  await refreshShelf();
  if (imported) toast(`已导入 ${imported} 本 TXT`);
}

/* ------------------------------ 阅读器 ------------------------------ */

function currentChapter() {
  return getChapterText(state.current.content, state.current.chapters, state.chapterIndex);
}

function currentOffset() {
  const chapter = currentChapter();
  const max = els.content.scrollHeight - els.content.clientHeight;
  const ratio = max > 0 ? Math.min(1, Math.max(0, els.content.scrollTop / max)) : 0;
  return chapter.start + Math.round(ratio * chapter.text.length);
}

function updateProgress() {
  if (!state.current) return;
  const offset = currentOffset();
  const percent = computePercent(state.current.content.length, offset);
  state.current.offset = offset;
  state.current.percent = percent;
  els.percentLabel.textContent = `${percent}%`;
  els.progressFill.style.width = `${percent}%`;
  scheduleProgressSave(offset, percent);
}

function scheduleProgressSave(offset, percent) {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    if (!state.current) return;
    saveProgress(state.current.id, offset, state.chapterIndex, percent).catch(showError);
  }, 350);
}

function buildToc() {
  const chapters = state.current.chapters || [];
  els.tocList.replaceChildren();
  if (!chapters.length) {
    const hint = document.createElement('div');
    hint.className = 'muted';
    hint.textContent = '未识别到章节标题，按全文连续阅读。';
    els.tocList.append(hint);
  }
  chapters.forEach((chapter, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `toc-item${index === state.chapterIndex ? ' active' : ''}`;
    button.textContent = `${index + 1}. ${chapter.title}`;
    button.addEventListener('click', () => {
      goChapter(index);
      els.tocPanel.hidden = true;
    });
    els.tocList.append(button);
  });
  els.prevChapterBtn.disabled = chapters.length === 0 || state.chapterIndex === 0;
  els.nextChapterBtn.disabled = chapters.length === 0 || state.chapterIndex >= chapters.length - 1;
}

function renderChapter(restoreRatio = 0) {
  const chapter = currentChapter();
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
  els.content.replaceChildren(inner);
  els.content.scrollTop = 0;

  const count = state.current.chapters?.length || 0;
  els.chapterLabel.textContent = count
    ? `第 ${state.chapterIndex + 1}/${count} 章 · ${chapter.title}`
    : '全文';
  buildToc();
  updateProgress();

  if (restoreRatio > 0) {
    requestAnimationFrame(() => {
      const max = els.content.scrollHeight - els.content.clientHeight;
      els.content.scrollTop = Math.min(1, Math.max(0, restoreRatio)) * max;
      updateProgress();
    });
  }
}

function goChapter(index) {
  const chapters = state.current.chapters || [];
  if (!chapters.length) return;
  state.chapterIndex = Math.min(Math.max(0, index), chapters.length - 1);
  renderChapter(0);
}

async function openBook(id) {
  const book = await getBook(id);
  if (!book) {
    toast('这本书已不存在');
    return refreshShelf();
  }
  state.current = book;
  const chapters = book.chapters || [];
  const saved = Number.isFinite(book.offset) ? book.offset : 0;
  state.chapterIndex = Math.min(Math.max(0, getChapterAt(chapters, saved)), Math.max(0, chapters.length - 1));
  const chapter = getChapterText(book.content, chapters, state.chapterIndex);
  const ratio = (saved - chapter.start) / Math.max(1, chapter.text.length);

  els.shelfView.hidden = true;
  els.readerView.hidden = false;
  els.readerBookTitle.textContent = book.title;
  els.tocPanel.hidden = true;
  els.settingsPanel.hidden = true;
  renderChapter(ratio);
  els.content.focus({ preventScroll: true });
}

function backToShelf() {
  clearTimeout(state.saveTimer);
  if (state.current) {
    saveProgress(state.current.id, state.current.offset, state.chapterIndex, state.current.percent)
      .catch(showError)
      .finally(() => refreshShelf().catch(showError));
  }
  state.current = null;
  els.readerView.hidden = true;
  els.shelfView.hidden = false;
  els.tocPanel.hidden = true;
  els.settingsPanel.hidden = true;
}

/* ------------------------------ 事件绑定 ------------------------------ */

function bindEvents() {
  els.importBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (event) => {
    handleFiles(event.target.files).catch(showError);
    event.target.value = '';
  });

  for (const type of ['dragenter', 'dragover']) {
    els.dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      els.dropZone.classList.add('dragover');
    });
  }
  els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
  els.dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('dragover');
    handleFiles(event.dataTransfer.files).catch(showError);
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());

  els.backBtn.addEventListener('click', backToShelf);
  els.tocBtn.addEventListener('click', () => {
    els.settingsPanel.hidden = true;
    els.tocPanel.hidden = !els.tocPanel.hidden;
  });
  els.tocCloseBtn.addEventListener('click', () => { els.tocPanel.hidden = true; });
  els.settingsBtn.addEventListener('click', () => {
    els.tocPanel.hidden = true;
    els.settingsPanel.hidden = !els.settingsPanel.hidden;
  });
  els.settingsCloseBtn.addEventListener('click', () => { els.settingsPanel.hidden = true; });

  els.prevChapterBtn.addEventListener('click', () => goChapter(state.chapterIndex - 1));
  els.nextChapterBtn.addEventListener('click', () => goChapter(state.chapterIndex + 1));
  els.content.addEventListener('scroll', updateProgress, { passive: true });

  els.themeSelect.addEventListener('change', (e) => {
    state.settings.theme = e.target.value;
    applySettings();
    scheduleSettingsSave();
  });
  const bindRange = (element, key, parse) => {
    element.addEventListener('input', (e) => {
      state.settings[key] = parse(e.target.value);
      applySettings();
      scheduleSettingsSave();
    });
  };
  bindRange(els.fontSizeRange, 'fontSize', Number);
  bindRange(els.lineHeightRange, 'lineHeight', Number);
  bindRange(els.pageWidthRange, 'pageWidth', Number);
  els.resetSettingsBtn.addEventListener('click', () => {
    state.settings = { ...DEFAULTS };
    applySettings();
    scheduleSettingsSave();
    toast('已恢复默认阅读设置');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      els.tocPanel.hidden = true;
      els.settingsPanel.hidden = true;
      return;
    }
    if (els.readerView.hidden || event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowLeft') goChapter(state.chapterIndex - 1);
    if (event.key === 'ArrowRight') goChapter(state.chapterIndex + 1);
  });

  window.addEventListener('pagehide', () => {
    clearTimeout(state.saveTimer);
    if (state.current) {
      saveProgress(state.current.id, state.current.offset, state.chapterIndex, state.current.percent).catch(() => {});
    }
  });
}

async function init() {
  state.settings = await getSettings(DEFAULTS);
  applySettings();
  bindEvents();
  await refreshShelf();
}

init().catch((error) => {
  showError(error);
  const hint = document.createElement('div');
  hint.className = 'empty-state';
  hint.textContent = '初始化失败：请通过 npm start 启动本地服务后用浏览器访问，不要直接双击打开 HTML 文件。';
  els.shelfView.prepend(hint);
});
