# UPX-Tools 常用命令，运行 `just` 或 `just --list` 查看全部

[private]
default:
    @just --list

# 开发模式运行（热重载，先编译一次 Tailwind CSS）
dev: css
    cargo tauri dev

# 构建 CSS、安装包和便携版
build: css
    npm run build

# Tailwind CSS：just css 构建，just css watch 监听
css mode='build':
    npm run {{ mode }}:css

# 统一格式化前端和 Rust
fmt:
    npm run format
    cargo fmt --manifest-path src-tauri/Cargo.toml

# 只读检查：前端 lint/格式、Rust 格式/clippy
check:
    npm run check
    cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
    cargo clippy --manifest-path src-tauri/Cargo.toml

# 清理 Rust 构建产物
clean:
    cargo clean --manifest-path src-tauri/Cargo.toml
