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
- **分块并发批处理**：前端按启动时的 CPU 逻辑处理器数计算每批并发上限，后端执行单文件 UPX 命令
- **配置持久化**：保存到可执行文件同目录的 `upx_gui_config.json`，需要该目录可写
- **便携版支持**：使用 `include_bytes!` 嵌入 UPX，运行时释放到临时目录

## 常用命令

```bash
# 开发模式运行（先生成 CSS；也可使用 just dev）
npm run build:css
cargo tauri dev

# 编译安装包及 release 主程序（不会自动构建 CSS）
cargo tauri build

# 编译产物位置
# src-tauri/target/release/bundle/
# Tauri 目标为 MSI、NSIS；Portable 由 npm run post-build 复制主程序

# 前端代码检查
npm run lint          # 检查代码问题
npm run lint:fix      # 自动修复
npm run format        # 格式化代码
npm run format:check  # 检查前端格式
npm run check         # 前端 lint + 格式检查，不包含 Rust

# Tailwind CSS 构建
npm run build:css     # 编译并压缩 Tailwind CSS
npm run watch:css     # 监听模式编译 Tailwind CSS

# 完整构建（包含便携版复制）
npm run build         # 编译 Tauri 并复制便携版到 bundle 目录

# 可选 just 快捷入口（6 个常用入口，底层 npm/Cargo 命令仍可单独运行）
just                  # 显示菜单，默认配方不在列表中显示
just dev              # 构建 CSS + Tauri 开发模式
just build            # 构建 CSS + 安装包 + 便携版复制
just css              # 构建 CSS；just css watch 监听
just fmt              # 前端 Prettier + Rust 格式化
just check            # 前端 lint/格式 + Rust 格式检查/clippy，不含测试
just clean            # 清理 Rust 构建产物

# Rust 检查与格式化（从项目根目录执行）
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

`.justfile` 使用 `set quiet` 隐藏命令回显，并导出 `npm_config_loglevel=warn` 隐藏 npm notice（包括嵌套调用）；保留工具输出、警告和错误。`post-build` 仅将 `New-Item` 的目录对象输出送入 `Out-Null`，不重定向错误。

## 代码结构

### 前端 (ui/)
- `index.html` - 主界面，包含双操作按钮布局、设置弹窗、更新弹窗
- `js/main.js` - 前端逻辑，包含：
  - 拖放检测与区域判断（通过按钮位置缓存 `cachedButtonRects`）
  - 动态批处理（基于 CPU 核心数）
  - 配置的保存/加载
  - 日志系统（带数量限制和自动清理，最大 1000 条）
  - 更新检查与下载
- `css/style.css` - 主样式，包含 shadcn/ui CSS 变量、自定义按钮、弹窗动画
- `css/main.css` - Tailwind 入口文件（需编译）
- `css/tailwind.css` - `npm run build:css` 生成的样式；Tauri 构建钩子为空，开发、构建或发布前需显式更新

### 后端 (src-tauri/src/)
- `main.rs` - 唯一的 Rust 源文件，按功能分区：
  - **数据结构定义**：`UpxOptions`、`ScanFolderOptions`、`AppConfig`；更新区定义 `GitHubRelease`、`GitHubAsset`、`UpdateInfo`
  - **路径解析**：`get_upx_path()` 多级查找（安装版 → 开发版 → 便携版嵌入资源）
  - **命令构建辅助**：`build_compress_args()`、`build_decompress_args()`
  - **输出处理**：`filter_output_lines()`、`parse_upx_error()` 智能过滤和错误解析
  - **Tauri Commands**：
    - `process_upx` - 执行压缩/解压（支持 tokio 阻塞任务）
    - `scan_folder` - 扫描 exe/dll 文件，按选项决定是否递归
    - `get_upx_version` - 获取 UPX 版本
    - `refresh_icon_cache` - 刷新 Windows 图标缓存
    - `check_update` / `download_and_install` - 检查 GitHub 更新，下载到临时目录并启动文件，不确认安装完成
    - `save_config` / `load_config` - 配置持久化

### 构建配置
- `src-tauri/tauri.conf.json` - Tauri 配置，定义窗口属性、权限、打包设置
- `src-tauri/Cargo.toml` - Rust 依赖，release profile 优化（strip、lto、opt-level=z）
- `.justfile` - 可选的开发、CSS 构建、检查和格式化快捷入口
- `.github/workflows/ci.yml` - Rust 格式检查、严格 clippy 和测试
- `.github/workflows/build.yml` - Windows x64 MSI/NSIS 构建与 artifact 上传
- `.github/workflows/release.yml` - `v*` tag 自动发布 MSI、NSIS 安装包和 Portable 便携版；不运行前端检查或 CSS 构建

## 重要细节

### UPX 路径解析（三级查找）
1. **安装版**：`程序目录/_up_/upx/upx.exe`
2. **开发路径**：当前工作目录下的 `../upx/upx.exe`（通常在 `src-tauri/` 中运行）
3. **便携版**：从嵌入的 `EMBEDDED_UPX` 释放到 `%TEMP%/upx-gui-portable/upx.exe`

`EMBEDDED_UPX` 对所有构建无条件嵌入。释放结果通过 `OnceLock<Option<PathBuf>>` 缓存；已有临时文件仅按长度判断是否复用，不校验内容哈希。仓库当前 `upx/upx.exe` 为 UPX 5.2.1，可用 `--version` 核对。

### 编码处理
后端使用 `encoding_rs::GBK` 解码 UPX 的标准输出和标准错误，再进行过滤和错误解析。

### 批处理并发策略
```javascript
cpuCores = navigator.hardwareConcurrency || 4
batchSize = Math.max(2, Math.min(cpuCores * 2, 16))
```
初始化时计算一次，每块上限 2–16，无法获取逻辑处理器数时按 4 计算（上限 8）。`processBatchFiles` 对每块使用 `Promise.all`，等待整块完成后再处理下一块；不是运行中自适应调度，也不是整个应用的全局并发限额。

### 处理语义与配置
- 操作按钮打开多选 EXE/DLL 文件对话框，没有目录选择；文件夹通过拖放添加。落在操作按钮内立即处理，落在其他区域暂存后再点击按钮。
- 覆盖设置仅影响压缩；未覆盖时逐文件请求保存路径，默认追加 `_packed`。脱壳始终以相同输入输出路径覆盖原文件。
- 备份为输入完整路径追加 `.bak`，压缩/脱壳及另存压缩都会创建；已有备份会被覆盖，备份失败则停止该文件处理。
- 压缩滑条 10 映射为 `best`，配置中仍保存整数 10；`--ultra-brute` 优先于压缩级别。LZMA 和极限压缩只参与压缩参数，强制选项在两种模式中均传 `--force`。
- 点击「保存设置」或设置遮罩时保存；修改控件或关闭应用不会保存。字段和默认值见 README 设置表；缺少文件时后端返回默认配置，读取/解析失败时前端保留默认 UI。
- `AppConfig` 只有 `auto_check_update` 字段设有 serde 缺字段默认值（true）；不要假定缺少其他字段的旧 JSON 也能加载。

### 更新流程
- 更新仓库固定为 `Y-ASLant/UPX-Tools`，当前版本来自 Cargo 包版本；检查 `/releases/latest`，不是完整 SemVer 比较。
- 默认启动时约 1 秒后自动检查，亦可手动检查；有更新显示应用内弹窗，不自动打开浏览器。后端筛选 portable/setup/MSI，前端只展示 portable/setup EXE。
- `GITHUB_TOKEN` 仅作为检查 API 的 Bearer token，资产下载不带它。下载到系统临时目录 `upx-tools-update/` 后用 Windows `cmd /C start` 启动，便携版不会原位替换旧程序，当前应用不会自动退出。
- 下载进度条为模拟动画，不是网络进度；流程没有资产哈希/签名验证，也不等待或验证安装结果。

### 当前实现限制（维护时注意）
- `processUpx` 和单文件 handler 捕获错误后不重新抛出；批处理会把这些失败以及取消保存位置计入成功。应以单文件日志判断结果。
- 拖放路径没有去重，也没有全局批处理锁；扫描先应用于所有路径，直接拖文件可能先出现「不是文件夹」错误再处理该文件。按钮外单文件/多文件暂存值也未互相清除。
- 目录读取失败或部分目录项错误可能被忽略，扫描结果不保证完整；递归扫描没有已访问目录集合。
- 配置保存错误仅写控制台，按钮仍可提示「设置已保存」；图标刷新忽略系统命令错误，返回成功不保证实际清理完成。
- 关闭更新弹窗不会取消下载；下载失败路径未清除模拟进度定时器。

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

1. 同步修改 `src-tauri/Cargo.toml`、`package.json` 和 `src-tauri/tauri.conf.json` 中的版本号；当前版本均为 `1.5.0`，更新检查使用 `env!("CARGO_PKG_VERSION")`
2. 在本地运行前端检查并更新 CSS；GitHub Actions 不安装 Node.js，也不运行 Tailwind 构建
3. 推送 tag：`git tag v1.x.x && git push origin v1.x.x`
4. GitHub Actions 在 Windows x64 上构建并发布 Release，资产版本名取自 tag：
   - `UPX-Tools-{version}-x64.msi` - MSI 安装包
   - `UPX-Tools-{version}-x64-setup.exe` - NSIS 安装包（当前用户安装）
   - `UPX-Tools-{version}-x64-portable.exe` - 便携版（release 主程序副本，单文件内嵌 UPX，仍依赖 WebView2）

构建环境要求 Windows、Rust stable/MSVC、Microsoft C++ Build Tools、WebView2 和 Tauri CLI 2；前端使用受支持的 Node.js LTS。安装 CLI 使用 `cargo install tauri-cli --version "^2.0.0" --locked`，npm CLI 不替代现有脚本中的 `cargo tauri`。
