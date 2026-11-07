//! 阶段 0 的验证工具：扫描任意真实书库目录，检查中文路径、格式分布与按需读取。
//! 用法：cargo run --manifest-path src-tauri/Cargo.toml --bin scan -- <书库目录> [--save <索引.json>]

use jiandu_library::{resolve_within, Library, Progress};
use std::collections::BTreeMap;
use std::env;
use std::path::Path;
use std::process;
use std::time::Instant;

fn fail(message: impl std::fmt::Display) -> ! {
    eprintln!("{message}");
    process::exit(1);
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("用法: scan <书库目录> [--save <索引.json>]");
        process::exit(2);
    }
    let root = Path::new(&args[1]);
    let started = Instant::now();
    let mut library = Library::open(root).unwrap_or_else(|error| fail(format!("打开书库失败: {error}")));
    let count = library.scan().unwrap_or_else(|error| fail(format!("扫描失败: {error}")));
    let elapsed = started.elapsed();

    println!("书库根目录: {}", library.root().display());
    println!("扫描耗时: {elapsed:?}");
    println!("收录书籍: {count}");

    let mut by_format: BTreeMap<&str, usize> = BTreeMap::new();
    for book in library.books() {
        *by_format.entry(book.format.as_str()).or_insert(0) += 1;
    }
    println!("格式分布: {by_format:?}");

    println!("前 5 本:");
    for book in library.books().iter().take(5) {
        println!("  [{}] {} ({} 字节)", book.format.as_str(), book.title, book.size);
    }

    let chinese: Vec<_> = library.books().iter()
        .filter(|book| book.title.chars().any(|ch| !ch.is_ascii()))
        .take(3)
        .collect();
    if !chinese.is_empty() {
        println!("中文书名与路径示例:");
        for book in chinese { println!("  {} -> {}", book.title, book.path); }
    }

    if let Some(first) = library.books().first() {
        match library.read_book(&first.id) {
            Ok(bytes) => println!("首本按需读取成功: {} ({} 字节)", first.title, bytes.len()),
            Err(error) => println!("首本按需读取失败: {error}"),
        }
        library.set_progress(first.id.clone(), Progress::new(12.0, 1, 25.0));
    }

    // 越界路径必须被拒绝或不可达，绝不能读到书库外的文件。
    let outside = std::env::temp_dir();
    match resolve_within(root, &outside) {
        Ok(path) => println!("警告: 书库外路径未被拒绝: {}", path.display()),
        Err(error) => println!("越界防护: {error}"),
    }

    if let Some(position) = args.iter().position(|arg| arg == "--save") {
        if let Some(target) = args.get(position + 1) {
            match library.save(Path::new(target)) {
                Ok(()) => println!("索引与进度已保存: {target}"),
                Err(error) => println!("索引保存失败: {error}"),
            }
        }
    }
}
