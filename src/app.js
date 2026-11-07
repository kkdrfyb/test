import { computePercent, getChapterAt, getChapterText } from './text.js';
import { inspectFile, createDocument, ACCEPT_ATTR } from './formats.js';
import {
  getAllBooks,
  getBook,
  putBook,
  putFile,
  getFile,
  deleteBook,
  saveProgress,
  getSettings,
  saveSettings,
  isDesktop,
  libraryRoot,
  scanLibrary,
  pickLibraryDir,
} from './backend.js';

const DEFAULTS = { fontSize: 18, lineHeight: 1.8, pageWidth: 760, theme: 'light', pdfScale: 1.2 };
const MAX_TOC_ITEMS = 500;
/** 大书库一次最多渲染 500 张卡片，其余通过书名筛选定位。 */
const SHELF_RENDER_LIMIT = 500;
const $ = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

const els = {
  shelfView: $('shelfView'), readerView: $('readerView'),
  importBtn: $('importBtn'), fileInput: $('fileInput'), dropZone: $('dropZone'),
  bookList: $('bookList'), bookCount: $('bookCount'), emptyState: $('emptyState'),
  desktopBar: $('desktopBar'), scanBtn: $('scanBtn'), libraryRootLabel: $('libraryRootLabel'),
  searchInput: $('searchInput'),
  backBtn: $('backBtn'), readerBookTitle: $('readerBookTitle'),
  tocBtn: $('tocBtn'), settingsBtn: $('settingsBtn'),
  tocPanel: $('tocPanel'), tocList: $('tocList'), tocCloseBtn: $('tocCloseBtn'),
  settingsPanel: $('settingsPanel'), settingsCloseBtn: $('settingsCloseBtn'),
  themeSelect: $('themeSelect'), fontSizeRange: $('fontSizeRange'),
  lineHeightRange: $('lineHeightRange'), pageWidthRange: $('pageWidthRange'),
  fontSizeValue: $('fontSizeValue'), lineHeightValue: $('lineHeightValue'),
  pageWidthValue: $('pageWidthValue'), resetSettingsBtn: $('resetSettingsBtn'),
  pdfTools: $('pdfTools'), pageInput: $('pageInput'), pageTotal: $('pageTotal'), zoomSelect: $('zoomSelect'),
  content: $('content'), chapterLabel: $('chapterLabel'),
  percentLabel: $('percentLabel'), progressFill: $('progressFill'),
  prevChapterBtn: $('prevChapterBtn'), nextChapterBtn: $('nextChapterBtn'),
  toast: $('toast'),
};

const state = {
  books: [],
  desktop: isDesktop(),
  search: '',
  current: null,
  doc: null,
  chapterIndex: 0,
  renderToken: 0,
  settings: { ...DEFAULTS },
  saveTimer: null,
  settingsTimer: null,
  toastTimer: null,
};

const makeId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2800);
}

function showError(error) {
  console.error(error);
  toast(`出错：${error?.message || error}`);
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
  els.zoomSelect.value = String(s.pdfScale);
  els.fontSizeValue.textContent = `${s.fontSize}px`;
  els.lineHeightValue.textContent = String(s.lineHeight);
  els.pageWidthValue.textContent = `${s.pageWidth}px`;
}

function scheduleSettingsSave() {
  clearTimeout(state.settingsTimer);
  state.settingsTimer = setTimeout(() => { saveSettings(state.settings).catch(showError); }, 200);
}

/* ------------------------------ 书架 ------------------------------ */

async function refreshShelf() {
  state.books = await getAllBooks();
  const keyword = state.search.trim().toLowerCase();
  const matched = keyword
    ? state.books.filter((book) => book.title.toLowerCase().includes(keyword))
    : state.books;
  const visible = matched.slice(0, SHELF_RENDER_LIMIT);
  els.bookCount.textContent = keyword
    ? `共 ${state.books.length} 本 · 匹配 ${matched.length} 本`
    : `共 ${state.books.length} 本`;
  els.emptyState.hidden = matched.length > 0;
  if (!matched.length) {
    els.emptyState.textContent = keyword
      ? '没有匹配的书名，换个关键词试试。'
      : state.desktop
        ? '书架空空的，点上方「选择书库目录」扫描本地书籍。'
        : '书架空空的，导入一本 TXT / EPUB / PDF / CHM 试试吧。';
  }

  const fragment = document.createDocumentFragment();
  for (const book of visible) {
    const card = document.createElement('div');
    card.className = 'book-card';
    card.addEventListener('click', () => openBook(book.id).catch(showError));

    const head = document.createElement('div');
    head.className = 'book-head';
    const name = document.createElement('div');
    name.className = 'book-name';
    name.textContent = book.title;
    const badge = document.createElement('span');
    badge.className = 'format-badge';
    badge.textContent = (book.format || 'txt').toUpperCase();
    head.append(name, badge);

    const meta = document.createElement('div');
    meta.className = 'book-meta';
    const unit = book.format === 'pdf' && book.total ? `${book.total} 页`
      : book.chapters?.length ? `${book.chapters.length} 章`
        : (book.format || 'txt').toUpperCase();
    meta.textContent = `${formatSize(book.size)} · ${unit} · ${formatDate(book.lastReadAt)}`;

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
    foot.append(percent);
    // 桌面书架只是路径索引，不能也不该删除磁盘上的原书。
    if (!state.desktop) {
      const del = document.createElement('button');
      del.className = 'delete-btn';
      del.type = 'button';
      del.textContent = '删除';
      del.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!window.confirm(`确定从书架移除《${book.title}》吗？`)) return;
        deleteBook(book.id).then(refreshShelf).catch(showError);
      });
      foot.append(del);
    }
    card.append(head, meta, bar, foot);
    fragment.append(card);
  }
  if (matched.length > visible.length) {
    const more = document.createElement('div');
    more.className = 'empty-state';
    more.textContent = `仅显示前 ${visible.length} 本，输入书名关键词可快速筛选其余 ${matched.length - visible.length} 本。`;
    fragment.append(more);
  }
  els.bookList.replaceChildren(fragment);
}

async function handleFiles(files) {
  if (state.desktop) {
    toast('桌面版通过「选择书库目录」管理书籍，不需要导入文件');
    return;
  }
  let imported = 0;
  for (const file of [...files]) {
    try {
      const { book, rawBytes } = await inspectFile(file);
      book.id = makeId();
      if (rawBytes) await putFile(book.id, rawBytes);
      await putBook(book);
      imported += 1;
    } catch (error) {
      showError(error);
    }
  }
  await refreshShelf();
  if (imported) toast(`已导入 ${imported} 本书`);
}

/* ------------------------------ 阅读器 ------------------------------ */

/** 三种进度单位：TXT 按字符、EPUB/CHM 按「章节 + 章内比例」、PDF 按页码。 */
function currentOffset() {
  const doc = state.doc;
  if (!doc) return 0;
  if (doc.unit === 'page') return state.chapterIndex + 1;
  const max = els.content.scrollHeight - els.content.clientHeight;
  const ratio = max > 0 ? clamp(els.content.scrollTop / max, 0, 1) : 0;
  if (doc.unit === 'chapter') return state.chapterIndex + ratio;
  const chapter = getChapterText(state.current.content, state.current.chapters || [], state.chapterIndex);
  return chapter.start + Math.round(ratio * chapter.text.length);
}

function updateProgress() {
  if (!state.current || !state.doc) return;
  const offset = currentOffset();
  const percent = computePercent(state.doc.total, offset);
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
  const doc = state.doc;
  const chapters = doc.chapters || [];
  els.tocList.replaceChildren();
  if (!chapters.length) {
    const hint = document.createElement('div');
    hint.className = 'muted';
    hint.textContent = '未识别到章节标题，按全文连续阅读。';
    els.tocList.append(hint);
  }
  chapters.slice(0, MAX_TOC_ITEMS).forEach((chapter, index) => {
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
  if (chapters.length > MAX_TOC_ITEMS) {
    const more = document.createElement('div');
    more.className = 'muted';
    more.textContent = `仅显示前 ${MAX_TOC_ITEMS} 项，其余可通过上/下${doc.unit === 'page' ? '页' : '章'}按钮浏览。`;
    els.tocList.append(more);
  }
  const last = Math.max(0, chapters.length - 1);
  els.prevChapterBtn.disabled = chapters.length === 0 || state.chapterIndex === 0;
  els.nextChapterBtn.disabled = chapters.length === 0 || state.chapterIndex >= last;
}

async function renderChapter(restoreRatio = 0) {
  const doc = state.doc;
  if (!doc) return;
  const token = ++state.renderToken;
  try {
    await doc.render(els.content, state.chapterIndex, { scale: state.settings.pdfScale });
  } catch (error) {
    if (error?.name === 'RenderingCancelledException') return;
    showError(error);
    return;
  }
  if (token !== state.renderToken) return;

  els.content.scrollTop = 0;
  const count = doc.chapters.length;
  const title = doc.chapters[state.chapterIndex]?.title || '';
  els.chapterLabel.textContent = doc.unit === 'page'
    ? `第 ${state.chapterIndex + 1}/${doc.total} 页`
    : count ? `第 ${state.chapterIndex + 1}/${count} 章 · ${title}` : '全文';
  els.pageInput.value = String(state.chapterIndex + 1);
  buildToc();
  updateProgress();

  if (restoreRatio > 0 && doc.unit !== 'page') {
    requestAnimationFrame(() => {
      const max = els.content.scrollHeight - els.content.clientHeight;
      els.content.scrollTop = clamp(restoreRatio, 0, 1) * max;
      updateProgress();
    });
  }
}

function goChapter(index) {
  const doc = state.doc;
  if (!doc) return;
  const last = Math.max(0, doc.chapters.length - 1);
  state.chapterIndex = clamp(index, 0, last);
  renderChapter(0).catch(showError);
}

async function openBook(id) {
  const book = await getBook(id);
  if (!book) {
    toast('这本书已不存在');
    return refreshShelf();
  }
  let rawBytes = null;
  if (book.format !== 'txt') {
    rawBytes = await getFile(id);
    if (!rawBytes) {
      toast('原始文件数据缺失，请重新导入这本书');
      return;
    }
  }
  const doc = await createDocument(book, rawBytes);
  if (state.doc?.dispose) await state.doc.dispose();
  state.current = book;
  state.doc = doc;

  const saved = Number.isFinite(book.offset) ? book.offset : 0;
  let ratio = 0;
  if (doc.unit === 'char') {
    const chapters = book.chapters || [];
    state.chapterIndex = clamp(getChapterAt(chapters, saved), 0, Math.max(0, chapters.length - 1));
    const chapter = getChapterText(book.content, chapters, state.chapterIndex);
    ratio = (saved - chapter.start) / Math.max(1, chapter.text.length);
  } else if (doc.unit === 'chapter') {
    state.chapterIndex = clamp(Math.floor(saved), 0, Math.max(0, doc.chapters.length - 1));
    ratio = saved - state.chapterIndex;
  } else {
    state.chapterIndex = clamp(Math.round(saved) - 1, 0, Math.max(0, doc.total - 1));
  }

  els.shelfView.hidden = true;
  els.readerView.hidden = false;
  els.readerBookTitle.textContent = book.title;
  els.tocPanel.hidden = true;
  els.settingsPanel.hidden = true;
  els.pdfTools.hidden = doc.unit !== 'page';
  els.pageTotal.textContent = String(doc.total);
  els.pageInput.max = String(doc.total);
  els.prevChapterBtn.textContent = doc.unit === 'page' ? '上一页' : '上一章';
  els.nextChapterBtn.textContent = doc.unit === 'page' ? '下一页' : '下一章';
  await renderChapter(ratio);
  els.content.focus({ preventScroll: true });
}

function backToShelf() {
  clearTimeout(state.saveTimer);
  if (state.current) {
    saveProgress(state.current.id, state.current.offset, state.chapterIndex, state.current.percent)
      .catch(showError)
      .finally(() => refreshShelf().catch(showError));
  }
  state.doc?.dispose?.();
  state.doc = null;
  state.current = null;
  state.renderToken += 1;
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

  els.searchInput.addEventListener('input', (event) => {
    state.search = event.target.value;
    refreshShelf().catch(showError);
  });
  els.scanBtn.addEventListener('click', async () => {
    try {
      const dir = await pickLibraryDir();
      if (!dir) return;
      toast('正在扫描书库目录…');
      const data = await scanLibrary(dir);
      state.search = '';
      els.searchInput.value = '';
      await refreshShelf();
      els.libraryRootLabel.textContent = `书库：${data?.root || dir}`;
      toast(`已索引 ${data?.books?.length ?? 0} 本书`);
    } catch (error) {
      showError(error);
    }
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
  els.pageInput.addEventListener('change', (event) => goChapter(Number(event.target.value) - 1));
  els.zoomSelect.addEventListener('change', (event) => {
    state.settings.pdfScale = Number(event.target.value);
    scheduleSettingsSave();
    if (state.doc?.unit === 'page') renderChapter(0).catch(showError);
  });

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
  els.fileInput.accept = ACCEPT_ATTR;
  state.settings = await getSettings(DEFAULTS);
  applySettings();
  bindEvents();
  if (state.desktop) {
    els.importBtn.hidden = true;
    els.dropZone.hidden = true;
    els.desktopBar.hidden = false;
    const root = await libraryRoot();
    els.libraryRootLabel.textContent = root ? `书库：${root}` : '尚未选择书库目录，点击左侧按钮指定文件夹';
  }
  await refreshShelf();
}

init().catch((error) => {
  showError(error);
  const hint = document.createElement('div');
  hint.className = 'empty-state';
  hint.textContent = '初始化失败：浏览器预览请先执行 npm start；桌面窗口请确认本地服务或打包资源已就绪。';
  els.shelfView.prepend(hint);
});
