//! 简读本地客户端的 Rust 侧书库能力。
//!
//! 默认编译产物是纯 Rust 库（不依赖 tauri），可独立 `cargo test`，
//! 也可由 `src/bin/scan.rs` 直接扫描真实书库目录。
//! 启用 `desktop` feature 后才会编译 `commands` 与 `src/main.rs` 桌面窗口。

pub mod library;

#[cfg(feature = "desktop")]
pub mod commands;

pub use library::{
    load_data, load_settings, natural_cmp, resolve_within, save_data, save_settings, stable_id,
    Book, BookFormat, Library, LibraryData, LibraryError, Progress, SUPPORTED_EXTENSIONS,
};
