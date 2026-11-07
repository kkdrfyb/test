use jiandu_library::{
    load_data, load_settings, natural_cmp, resolve_within, save_settings, stable_id, BookFormat,
    Library, LibraryData, LibraryError, Progress, SUPPORTED_EXTENSIONS,
};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir()
            .join(format!("jiandu-{label}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path { &self.0 }
}

impl Drop for TempDir {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

#[test]
fn 格式识别覆盖四种扩展名与大小写() {
    assert_eq!(SUPPORTED_EXTENSIONS.len(), 4);
    assert_eq!(BookFormat::from_path(Path::new("a.txt")), Some(BookFormat::Txt));
    assert_eq!(BookFormat::from_path(Path::new("a.EPUB")), Some(BookFormat::Epub));
    assert_eq!(BookFormat::from_path(Path::new("a.PDF")), Some(BookFormat::Pdf));
    assert_eq!(BookFormat::from_path(Path::new("a.CHM")), Some(BookFormat::Chm));
    assert_eq!(BookFormat::from_path(Path::new("a.mobi")), None);
    assert_eq!(BookFormat::from_path(Path::new("无扩展名")), None);
    assert_eq!(BookFormat::Chm.as_str(), "chm");
}

#[test]
fn 路径标识稳定且与分隔符大小写无关() {
    assert_eq!(stable_id("D:\\Books\\1984.chm"), stable_id("d:/books/1984.chm"));
    assert_ne!(stable_id("D:/a.txt"), stable_id("D:/b.txt"));
    assert_eq!(stable_id("D:/a.txt").len(), 16);
}

#[test]
fn 自然排序让第2章排在第10章之前() {
    let mut names = vec!["第10章", "第2章", "第1章"];
    names.sort_by(|a, b| natural_cmp(a, b));
    assert_eq!(names, vec!["第1章", "第2章", "第10章"]);
}

#[test]
fn 扫描中文目录只收录支持的格式并保留可读路径() {
    let temp = TempDir::new("scan");
    let root = temp.path().join("测试书库");
    fs::create_dir_all(root.join("子目录")).unwrap();
    fs::write(root.join("第1章.txt"), "一").unwrap();
    fs::write(root.join("第2章.txt"), "二").unwrap();
    fs::write(root.join("第10章.txt"), "十").unwrap();
    fs::write(root.join("1984.chm"), b"chm").unwrap();
    fs::write(root.join("子目录").join("封面.PDF"), b"pdf").unwrap();
    fs::write(root.join("notes.md"), "忽略").unwrap();
    fs::write(root.join(".hidden.txt"), "忽略").unwrap();

    let mut library = Library::open(&root).unwrap();
    assert_eq!(library.scan().unwrap(), 5);
    assert!(library.books().iter().all(|book| book.path.contains("测试书库")));
    assert!(library.books().iter().any(|book| book.title == "1984" && book.format == BookFormat::Chm));
    assert!(library.books().iter().any(|book| book.title == "封面" && book.format == BookFormat::Pdf));

    let titles: Vec<&str> = library.books().iter().map(|book| book.title.as_str()).collect();
    let second = titles.iter().position(|title| *title == "第2章").unwrap();
    let tenth = titles.iter().position(|title| *title == "第10章").unwrap();
    assert!(second < tenth, "目录应按自然序排列: {titles:?}");

    let chm = library.books().iter().find(|book| book.title == "1984").unwrap();
    assert_eq!(library.read_book(&chm.id).unwrap(), b"chm".to_vec());
    assert!(matches!(library.read_book("不存在的ID"), Err(LibraryError::UnknownBook(_))));
}

#[test]
fn 用户传入正斜杠根目录时路径分隔符仍然统一() {
    let temp = TempDir::new("separator");
    let root = temp.path().join("中文书库");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("第一卷.txt"), "正文").unwrap();
    let forward = PathBuf::from(root.to_string_lossy().replace('\\', "/"));
    let mut library = Library::open(&forward).unwrap();
    assert_eq!(library.scan().unwrap(), 1);
    let path = &library.books()[0].path;
    assert!(path.contains("中文书库"), "路径应保留中文目录: {path}");
    assert!(!(path.contains('/') && path.contains('\\')), "路径不应混用分隔符: {path}");
    assert_eq!(String::from_utf8(library.read_book(&library.books()[0].id).unwrap()).unwrap(), "正文");
}

#[test]
fn 路径越界与符号逃逸被拒绝() {
    let temp = TempDir::new("escape");
    let root = temp.path().join("library");
    fs::create_dir_all(&root).unwrap();
    let inside = root.join("book.txt");
    fs::write(&inside, "正文").unwrap();
    let outside = temp.path().join("secret.txt");
    fs::write(&outside, "秘密").unwrap();

    assert!(resolve_within(&root, &inside).is_ok());
    assert!(matches!(
        resolve_within(&root, &root.join("..").join("secret.txt")),
        Err(LibraryError::OutsideLibrary(_))
    ));
    assert!(matches!(resolve_within(&root, &outside), Err(LibraryError::OutsideLibrary(_))));
}

#[test]
fn 根目录必须是存在的文件() {
    let temp = TempDir::new("root");
    assert!(matches!(Library::open(temp.path().join("不存在")), Err(LibraryError::InvalidRoot(_))));
    let file = temp.path().join("not-a-dir.txt");
    fs::write(&file, "x").unwrap();
    assert!(matches!(Library::open(&file), Err(LibraryError::InvalidRoot(_))));
    assert!(Library::open(temp.path()).is_ok());
}

#[test]
fn 索引与进度可往返且重复保存不损坏() {
    let temp = TempDir::new("data");
    fs::write(temp.path().join("中文小说.txt"), "正文内容").unwrap();
    let index = temp.path().join("data").join("library.json");

    let mut library = Library::open(temp.path()).unwrap();
    library.scan().unwrap();
    let id = library.books()[0].id.clone();
    let expected = Progress::new(12.5, 2, 30.0);
    library.set_progress(id.clone(), expected.clone());
    library.save(&index).unwrap();

    let restored = Library::load(&index).unwrap();
    assert_eq!(restored.books(), library.books());
    assert_eq!(restored.get_progress(&id), Some(&expected));
    assert_eq!(String::from_utf8(restored.read_book(&id).unwrap()).unwrap(), "正文内容");

    library.set_progress(id.clone(), Progress::new(99.0, 3, 90.0));
    library.save(&index).unwrap();
    assert_eq!(Library::load(&index).unwrap().get_progress(&id).unwrap().offset, 99.0);
    assert!(!index.with_extension("json.tmp").exists(), "临时文件应已被替换掉");
}

#[test]
fn 索引文件不存在时返回空书库数据() {
    let temp = TempDir::new("empty");
    assert_eq!(load_data(&temp.path().join("missing.json")).unwrap(), LibraryData::default());
}

/** 对应 commands::scan_library 的 from_data 路径：重扫不能丢阅读记录。 */
#[test]
fn 重新扫描目录保留旧进度并纳入新增书籍() {
    let temp = TempDir::new("rescan");
    fs::write(temp.path().join("a.txt"), "A").unwrap();
    let index = temp.path().join("library.json");

    let mut library = Library::open(temp.path()).unwrap();
    library.scan().unwrap();
    let id = library.books()[0].id.clone();
    library.set_progress(id.clone(), Progress::new(7.0, 1, 25.0));
    library.save(&index).unwrap();

    fs::write(temp.path().join("b.txt"), "B").unwrap();
    let previous = load_data(&index).unwrap();
    let mut rescanned = Library::from_data(LibraryData {
        root: temp.path().to_string_lossy().into_owned(),
        ..previous
    }).unwrap();
    assert_eq!(rescanned.scan().unwrap(), 2);
    assert_eq!(rescanned.get_progress(&id).unwrap().offset, 7.0);
}

#[test]
fn 阅读设置独立持久化且缺省为空对象() {
    let temp = TempDir::new("settings");
    let path = temp.path().join("settings.json");
    assert_eq!(load_settings(&path).unwrap(), json!({}));
    let value = json!({ "theme": "dark", "fontSize": 22 });
    save_settings(&path, &value).unwrap();
    assert_eq!(load_settings(&path).unwrap(), value);
    fs::write(&path, "{损坏的 JSON").unwrap();
    assert!(load_settings(&path).is_err());
}
