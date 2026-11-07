//! 本地书库：扫描目录、索引元数据、按需读文件、持久化阅读进度。
//!
//! 设计约定：
//! - 书籍只保存路径引用，不把整本字节复制进应用数据（大书库的关键）。
//! - 所有文件访问都必须经过 `resolve_within` 校验，防止目录穿越与符号链接逃逸。
//! - Windows 路径可能是非 UTF-8，序列化统一用 `to_string_lossy`；比较时用规范化后的路径。
//! - 阶段 0 不依赖 tauri，纯 Rust 即可 `cargo test`。

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::{DirEntry, WalkDir};

pub const SUPPORTED_EXTENSIONS: [&str; 4] = ["txt", "epub", "pdf", "chm"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BookFormat {
    Txt,
    Epub,
    Pdf,
    Chm,
}

impl BookFormat {
    pub fn from_path(path: &Path) -> Option<Self> {
        let extension = path.extension()?.to_str()?.to_ascii_lowercase();
        match extension.as_str() {
            "txt" => Some(Self::Txt),
            "epub" => Some(Self::Epub),
            "pdf" => Some(Self::Pdf),
            "chm" => Some(Self::Chm),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Txt => "txt",
            Self::Epub => "epub",
            Self::Pdf => "pdf",
            Self::Chm => "chm",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub format: BookFormat,
    pub path: String,
    pub size: u64,
    pub modified_at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub offset: f64,
    pub chapter_index: usize,
    pub percent: f64,
    pub updated_at: u64,
}

impl Progress {
    pub fn new(offset: f64, chapter_index: usize, percent: f64) -> Self {
        Self { offset, chapter_index, percent, updated_at: now_millis() }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryData {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub root: String,
    #[serde(default)]
    pub books: Vec<Book>,
    #[serde(default)]
    pub progress: BTreeMap<String, Progress>,
}

#[derive(Debug)]
pub enum LibraryError {
    InvalidRoot(PathBuf),
    OutsideLibrary(PathBuf),
    UnknownBook(String),
    Io(io::Error),
    Json(serde_json::Error),
}

impl fmt::Display for LibraryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRoot(path) => write!(f, "书库根目录无效或不是文件夹：{}", path.display()),
            Self::OutsideLibrary(path) => write!(f, "路径超出书库范围：{}", path.display()),
            Self::UnknownBook(id) => write!(f, "书库中不存在这本书：{id}"),
            Self::Io(error) => write!(f, "文件读写失败：{error}"),
            Self::Json(error) => write!(f, "书库数据解析失败：{error}"),
        }
    }
}

impl std::error::Error for LibraryError {}

impl From<io::Error> for LibraryError {
    fn from(error: io::Error) -> Self { Self::Io(error) }
}

impl From<serde_json::Error> for LibraryError {
    fn from(error: serde_json::Error) -> Self { Self::Json(error) }
}

fn now_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/** FNV-1a 64：跨版本稳定的路径 ID，避免换一次扫描就丢阅读进度。 */
pub fn stable_id(path: &str) -> String {
    // Windows 文件系统大小写不敏感；统一分隔符后再哈希，避免同一本书生成两个 ID。
    let normalized = path.replace('\\', "/").to_lowercase();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in normalized.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[derive(Debug, PartialEq, Eq)]
enum Token {
    Num(u64, String),
    Text(String),
}

fn make_token(raw: String) -> Token {
    if raw.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
        Token::Num(raw.parse::<u64>().unwrap_or(u64::MAX), raw)
    } else {
        Token::Text(raw.to_lowercase())
    }
}

fn tokenize(value: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut buffer = String::new();
    let mut current: Option<bool> = None;
    for ch in value.chars() {
        let is_digit = ch.is_ascii_digit();
        if current.is_some() && current != Some(is_digit) {
            tokens.push(make_token(std::mem::take(&mut buffer)));
        }
        current = Some(is_digit);
        buffer.push(ch);
    }
    if !buffer.is_empty() { tokens.push(make_token(buffer)); }
    tokens
}

/** 数字感知排序：第 2 章排在 第 10 章 之前，与前端 Intl.Collator({numeric:true}) 对齐。 */
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let left = tokenize(a);
    let right = tokenize(b);
    for (x, y) in left.iter().zip(right.iter()) {
        let order = match (x, y) {
            (Token::Num(n1, s1), Token::Num(n2, s2)) => n1.cmp(n2).then_with(|| s1.cmp(s2)),
            (Token::Text(t1), Token::Text(t2)) => t1.cmp(t2),
            (Token::Num(..), Token::Text(_)) => Ordering::Less,
            (Token::Text(_), Token::Num(..)) => Ordering::Greater,
        };
        if order != Ordering::Equal { return order; }
    }
    left.len().cmp(&right.len())
}

fn is_hidden(entry: &DirEntry) -> bool {
    entry.depth() > 0 && entry.file_name().to_string_lossy().starts_with('.')
}

/** Windows 上用户可能传入 `D:/books`，WalkDir 拼接却用 `\`，统一成系统分隔符避免混合路径。 */
fn normalize_separators(path: PathBuf) -> PathBuf {
    let raw = path.to_string_lossy();
    if cfg!(windows) {
        PathBuf::from(raw.replace('/', "\\"))
    } else {
        PathBuf::from(raw.replace('\\', "/"))
    }
}

fn modified_millis(path: &Path) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/** 把请求路径限制在书库根目录内；canonicalize 会同时解析 `..` 与符号链接。 */
pub fn resolve_within(root: &Path, requested: &Path) -> Result<PathBuf, LibraryError> {
    let canonical_root = root.canonicalize()
        .map_err(|_| LibraryError::InvalidRoot(root.to_path_buf()))?;
    let candidate = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        canonical_root.join(requested)
    };
    let resolved = candidate.canonicalize()?;
    if !resolved.starts_with(&canonical_root) {
        return Err(LibraryError::OutsideLibrary(resolved));
    }
    Ok(resolved)
}

/** 读回持久化的索引与进度；文件不存在时返回空书库数据，方便首次启动。 */
pub fn load_data(path: &Path) -> Result<LibraryData, LibraryError> {
    if !path.exists() { return Ok(LibraryData::default()); }
    let text = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&text)?)
}

/** 先写临时文件再替换，避免写到一半留下损坏的 JSON。 */
pub fn save_data(path: &Path, data: &LibraryData) -> Result<(), LibraryError> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
    let temporary = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(data)?;
    fs::write(&temporary, json)?;
    // Windows 的 rename 不能覆盖已存在目标，因此先移除旧文件。
    if path.exists() { fs::remove_file(path)?; }
    fs::rename(&temporary, path)?;
    Ok(())
}

pub struct Library {
    root_display: PathBuf,
    root_canonical: PathBuf,
    books: Vec<Book>,
    progress: BTreeMap<String, Progress>,
}

impl Library {
    pub fn open(root: impl AsRef<Path>) -> Result<Self, LibraryError> {
        let input = root.as_ref();
        let canonical = input.canonicalize()
            .map_err(|_| LibraryError::InvalidRoot(input.to_path_buf()))?;
        if !canonical.is_dir() {
            return Err(LibraryError::InvalidRoot(input.to_path_buf()));
        }
        // canonicalize 在 Windows 会返回 \\?\ 前缀，不能直接展示给前端，单独保留可读路径。
        let display = if input.is_absolute() {
            input.to_path_buf()
        } else {
            std::env::current_dir()?.join(input)
        };
        Ok(Self {
            root_display: normalize_separators(display),
            root_canonical: canonical,
            books: Vec::new(),
            progress: BTreeMap::new(),
        })
    }

    pub fn root(&self) -> &Path { &self.root_display }

    pub fn books(&self) -> &[Book] { &self.books }

    /** 递归扫描书库，只收录四种支持的格式；重复扫描不会丢失已有阅读进度。 */
    pub fn scan(&mut self) -> Result<usize, LibraryError> {
        let mut books = Vec::new();
        let walker = WalkDir::new(&self.root_display)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| !is_hidden(entry));
        for result in walker {
            let entry = match result { Ok(entry) => entry, Err(_) => continue };
            if !entry.file_type().is_file() { continue; }
            let path = entry.path();
            let Some(format) = BookFormat::from_path(path) else { continue };
            let Ok(metadata) = fs::metadata(path) else { continue };
            let readable_path = path.to_string_lossy().into_owned();
            books.push(Book {
                id: stable_id(&readable_path),
                title: path.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default(),
                format,
                path: readable_path,
                size: metadata.len(),
                modified_at: modified_millis(path),
            });
        }
        books.sort_by(|a, b| natural_cmp(&a.title, &b.title).then_with(|| a.path.cmp(&b.path)));
        self.books = books;
        Ok(self.books.len())
    }

    /** 只按已登记的书 ID 读取文件，并再次校验路径没有逃出书库。 */
    pub fn read_book(&self, id: &str) -> Result<Vec<u8>, LibraryError> {
        let book = self.books.iter().find(|book| book.id == id)
            .ok_or_else(|| LibraryError::UnknownBook(id.to_string()))?;
        let resolved = resolve_within(&self.root_canonical, Path::new(&book.path))?;
        Ok(fs::read(resolved)?)
    }

    pub fn get_progress(&self, id: &str) -> Option<&Progress> { self.progress.get(id) }

    pub fn set_progress(&mut self, id: impl Into<String>, progress: Progress) {
        self.progress.insert(id.into(), progress);
    }

    pub fn to_data(&self) -> LibraryData {
        LibraryData {
            version: 1,
            root: self.root_display.to_string_lossy().into_owned(),
            books: self.books.clone(),
            progress: self.progress.clone(),
        }
    }

    pub fn from_data(data: LibraryData) -> Result<Self, LibraryError> {
        let mut library = Self::open(&data.root)?;
        library.books = data.books;
        library.progress = data.progress;
        Ok(library)
    }

    pub fn save(&self, path: &Path) -> Result<(), LibraryError> { save_data(path, &self.to_data()) }

    pub fn load(path: &Path) -> Result<Self, LibraryError> { Self::from_data(load_data(path)?) }
}
