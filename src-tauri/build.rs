// 只有桌面构建需要 tauri_build 生成 context / Windows 资源；
// 默认 cargo test 仍是纯 Rust 库，不触碰 Tauri 工具链。
fn main() {
    #[cfg(feature = "desktop")]
    {
        // frontendDist 被 generate_context! 内嵌进 exe，静态资源变化必须触发重新链接，
        // 否则改了 index.html / app.js 后打出来的仍是旧界面。
        println!("cargo:rerun-if-changed=../dist");
        tauri_build::build();
    }
}
