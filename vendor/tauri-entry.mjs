// 仅在桌面窗口环境下由 src/backend.js 动态加载；浏览器预览不会引入 Tauri API。
export { invoke } from '@tauri-apps/api/core';
export { open } from '@tauri-apps/plugin-dialog';
