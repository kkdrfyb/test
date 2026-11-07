// 只有桌面构建需要 tauri_build 生成 context / Windows 资源；
// 默认 cargo test 仍是纯 Rust 库，不触碰 Tauri 工具链。
fn main() {
    #[cfg(feature = "desktop")]
    tauri_build::build();
}
