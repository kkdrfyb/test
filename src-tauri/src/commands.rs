//! Tauri IPC 命令层：把纯书库能力暴露给 WebView。
//!
//! 命令层刻意保持很薄——所有路径校验、扫描与持久化都在 `library.rs`，
//! 这里只负责状态托管与序列化。前端 `src/backend.js` 与之一一对应。

use crate::library::{load_data, load_settings, Library, LibraryData, Progress};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tauri::{ipc::Response, State};

/** 应用数据目录里的索引与设置路径在启动时注入，命令本身不猜路径。 */
pub struct DesktopState {
    pub data_path: PathBuf,
    pub settings_path: PathBuf,
    pub library: Mutex<Option<Library>>,
    pub settings: Mutex<Value>,
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, String> {
    mutex.lock().map_err(|error| format!("书库状态暂时不可用：{error}"))
}

fn library_guard(state: &DesktopState) -> Result<MutexGuard<'_, Option<Library>>, String> {
    lock(&state.library)
}

fn data_of(library: &Option<Library>) -> LibraryData {
    library.as_ref().map(Library::to_data).unwrap_or_default()
}

/** 首次启动或用户尚未选目录时返回空数据，前端据此显示"选择书库"。 */
#[tauri::command]
pub fn library_state(state: State<'_, DesktopState>) -> Result<LibraryData, String> {
    let guard = library_guard(&state)?;
    Ok(data_of(&*guard))
}

/**
 * 扫描指定目录并重建索引；root 为空时沿用上次保存的书库根目录。
 * 通过 `from_data` 复用旧进度，重复扫描不会丢阅读记录。
 */
#[tauri::command]
pub fn scan_library(root: String, state: State<'_, DesktopState>) -> Result<LibraryData, String> {
    let chosen = if root.trim().is_empty() {
        load_data(&state.data_path).map_err(|e| e.to_string())?.root
    } else {
        root
    };
    if chosen.trim().is_empty() {
        return Err("请先选择书库目录".to_string());
    }
    let previous = load_data(&state.data_path).map_err(|e| e.to_string())?;
    let mut library = Library::from_data(LibraryData { root: chosen, ..previous })
        .map_err(|e| e.to_string())?;
    library.scan().map_err(|e| e.to_string())?;
    library.save(&state.data_path).map_err(|e| e.to_string())?;
    let data = library.to_data();
    *library_guard(&state)? = Some(library);
    Ok(data)
}

/** 按需返回整本书的原始字节；Raw IPC 通道避免把二进制膨胀成 JSON 数字数组。 */
#[tauri::command]
pub fn read_book(id: String, state: State<'_, DesktopState>) -> Result<Response, String> {
    let guard = library_guard(&state)?;
    let library = guard.as_ref().ok_or_else(|| "请先选择书库目录".to_string())?;
    let bytes = library.read_book(&id).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn save_progress(
    id: String,
    offset: f64,
    chapter_index: usize,
    percent: f64,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    let mut guard = library_guard(&state)?;
    let library = guard.as_mut().ok_or_else(|| "请先选择书库目录".to_string())?;
    library.set_progress(id, Progress::new(offset, chapter_index, percent));
    library.save(&state.data_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: State<'_, DesktopState>) -> Result<Value, String> {
    Ok(lock(&state.settings)?.clone())
}

#[tauri::command]
pub fn save_settings(value: Value, state: State<'_, DesktopState>) -> Result<(), String> {
    crate::library::save_settings(&state.settings_path, &value).map_err(|e| e.to_string())?;
    *lock(&state.settings)? = value;
    Ok(())
}

/** 启动准备逻辑抽成纯函数，便于单元测试路径与缺省值处理。 */
pub fn bootstrap_paths(data_dir: &Path) -> (PathBuf, PathBuf) {
    (data_dir.join("library.json"), data_dir.join("settings.json"))
}

pub fn initial_settings(path: &Path) -> Value {
    load_settings(path).unwrap_or_else(|_| Value::Object(Default::default()))
}
