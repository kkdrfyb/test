//! 简读本地客户端的 Rust 侧书库能力。
//!
//! 阶段 0 刻意不依赖 tauri：本 crate 是纯 Rust 库，可独立 `cargo test`，
//! 也可由 `src/bin/scan.rs` 直接扫描真实书库目录。阶段 1 会在这里加
//! `#[tauri::command]` 与 `src/main.rs`，把同样的接口暴露给 WebView。

pub mod library;

pub use library::{
    load_data, natural_cmp, resolve_within, save_data, stable_id, Book, BookFormat, Library,
    LibraryData, LibraryError, Progress, SUPPORTED_EXTENSIONS,
};
