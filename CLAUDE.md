# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this codebase.

## 项目概述

基于 Tauri 2.0 的 UPX 可视化加壳/脱壳工具，Windows 平台专用。

### 技术栈
- **前端**：原生 HTML + TailwindCSS + JavaScript（ui/ 目录）
- **后端**：Rust + Tauri 2.0（src-tauri/ 目录）
- **核心**：UPX 可执行文件（upx/upx.exe）

### 应用架构
- **单窗口应用**：自定义标题栏（无边框窗口 `decorations: false`）
- **拖放支持**：支持文件/文件夹拖放到窗口，自动判断操作区域
- **多线程批处理**：根据 CPU 核心数动态调整并发数
- **配置持久化**：配置保存在程序目录的 `upx_gui_config.json`
- **便携版支持**：使用 `include_bytes!` 嵌入 UPX，运行时释放到临时目录

## 常用命令

```bash
# 开发模式运行（热重载）
cargo tauri dev

# 编译发行版
cargo tauri build

# 编译产物位置
# src-tauri/target/release/bundle/
# 生成 MSI、NSIS 和 Portable 三种格式

# 前端代码检查
npm run lint          # 检查代码问题
npm run lint:fix      # 自动修复
npm run format        # 格式化代码
npm run check         # 完整检查

# Tailwind CSS 构建
npm run build:css     # 编译并压缩 Tailwind CSS
npm run watch:css     # 监听模式编译 Tailwind CSS

# 完整构建（包含便携版复制）
npm run build         # 编译 Tauri 并复制便携版到 bundle 目录
```

## 代码结构

### 前端 (ui/)
- `index.html` - 主界面，包含双操作按钮布局、设置弹窗、更新弹窗
- `js/main.js` - 前端逻辑（约 900 行），包含：
  - 拖放检测与区域判断（通过按钮位置缓存 `cachedButtonRects`）
  - 动态批处理（基于 CPU 核心数）
  - 配置的保存/加载
  - 日志系统（带数量限制和自动清理，最大 1000 条）
  - 更新检查与下载
- `css/style.css` - 主样式，包含 shadcn/ui CSS 变量、自定义按钮、弹窗动画
- `css/main.css` - Tailwind 入口文件（需编译）

### 后端 (src-tauri/src/)
- `main.rs` - 唯一的 Rust 源文件（约 500 行），采用模块化结构：
  - **数据结构定义**：`UpxOptions`、`ScanFolderOptions`、`AppConfig`、`UpdateInfo`
  - **路径解析**：`get_upx_path()` 多级查找（安装版 → 开发版 → 便携版嵌入资源）
  - **命令构建辅助**：`build_compress_args()`、`build_decompress_args()`
  - **输出处理**：`filter_output_lines()`、`parse_upx_error()` 智能过滤和错误解析
  - **Tauri Commands**：
    - `process_upx` - 执行压缩/解压（支持 tokio 阻塞任务）
    - `scan_folder` - 递归扫描 exe/dll 文件
    - `get_upx_version` - 获取 UPX 版本
    - `refresh_icon_cache` - 刷新 Windows 图标缓存
    - `check_update` / `download_and_install` - 检查和下载 GitHub 更新
    - `save_config` / `load_config` - 配置持久化

### 构建配置
- `src-tauri/tauri.conf.json` - Tauri 配置，定义窗口属性、权限、打包设置
- `src-tauri/Cargo.toml` - Rust 依赖，release profile 优化（strip、lto、opt-level=z）
- `.github/workflows/release.yml` - GitHub Actions 自动发布，生成 MSI、NSIS、Portable 三种安装包

## 重要细节

### UPX 路径解析（三级查找）
1. **安装版**：`程序目录/_up_/upx/upx.exe`
2. **开发版**：`../upx/upx.exe`（相对于项目根目录）
3. **便携版**：从嵌入的 `EMBEDDED_UPX` 释放到 `%TEMP%/upx-gui-portable/upx.exe`

### 编码处理
UPX 在 Windows 上输出 GBK 编码，使用 `encoding_rs::GBK` 转换为 UTF-8

### 批处理并发策略
```javascript
batchSize = Math.max(2, Math.min(cpuCores * 2, 16))
```
最小 2，最大 16，默认为 CPU 核心数的 2 倍

### 日志系统
- 最大日志条数：1000 条
- 超出时一次删除 200 条（批量删除优化性能）
- 支持不同日志类型：`info`、`error`、`warning`、`success`、`hint`
- 使用 `requestAnimationFrame` 优化滚动性能

### Tauri 2.0 特性
- 使用 `window.__TAURI__` 全局对象（需启用 `withGlobalTauri: true`）
- 命令调用：`invoke('command_name', { options })`
- 拖放事件：`listen('tauri://drag-drop', handler)`
- 权限通过 `capabilities` 定义（`main-capability`）

### 错误处理模式
后端使用模式匹配解析 UPX 输出，提供中文错误提示和解决方案：
- `AlreadyPackedException` - 文件已加壳
- `NotPackedException` - 文件未加壳
- `CantPackException` - 无法压缩
- `OverlayException` - 附加数据冲突

## 代码规范

### 前端 (JavaScript/HTML/CSS)
- **缩进**：4 空格
- **字符串**：单引号优先
- **分号**：不使用分号结尾
- **命名**：
  - 常量：`UPPER_SNAKE_CASE`
  - 函数/变量：`camelCase`
  - DOM ID：`kebab-case`
- **修改前端代码后必须运行**：`npm run format`

### 后端 (Rust)
- 使用 `cargo fmt` 格式化
- 使用 `cargo clippy` 检查代码质量
- Release profile 已优化：`strip = true`、`lto = true`、`opt-level = "z"`

### 界面风格
- 基于 shadcn/ui New York 风格，使用 neutral 基色
- 自定义字体：`YASLant`（回退到系统字体）
- 禁用右键菜单、F5 刷新、Ctrl+W 等浏览器默认行为

## 版本发布

1. 修改 `src-tauri/Cargo.toml` 和 `package.json` 中的版本号
2. 推送 tag：`git tag v1.x.x && git push origin v1.x.x`
3. GitHub Actions 自动构建并发布 Release
4. 生成三种安装包：
   - `UPX-Tools-{version}-x64.msi` - MSI 安装包
   - `UPX-Tools-{version}-x64-setup.exe` - NSIS 安装包
   - `UPX-Tools-{version}-x64-portable.exe` - 便携版（单文件，内嵌 UPX）
