#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! 桌面窗口入口：只在 `--features desktop` 下编译。
//! 开发期窗口加载 `devUrl`（现有 server.js），打包期加载 `frontendDist` 的静态副本。

use jiandu_library::commands::{
    self, bootstrap_paths, initial_settings, DesktopState,
};
use jiandu_library::Library;
use std::fs;
use std::sync::Mutex;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
            let (data_path, settings_path) = bootstrap_paths(&data_dir);
            app.manage(DesktopState {
                library: Mutex::new(Library::load(&data_path).ok()),
                settings: Mutex::new(initial_settings(&settings_path)),
                data_path,
                settings_path,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library_state,
            commands::scan_library,
            commands::read_book,
            commands::save_progress,
            commands::get_settings,
            commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("启动简读桌面窗口失败");
}
