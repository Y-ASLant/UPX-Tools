// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use encoding_rs::GBK;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// 嵌入 UPX 可执行文件（便携版支持）
const EMBEDDED_UPX: &[u8] = include_bytes!("../../upx/upx.exe");

// 缓存已释放的 UPX 路径
static EXTRACTED_UPX_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

// ============================================================================
// 数据结构定义
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
struct UpxOptions {
    mode: String,
    input_file: String,
    output_file: String,
    compression_level: String,
    backup: bool,
    ultra_brute: bool,
    force: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct ScanFolderOptions {
    folder_path: String,
    include_subfolders: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    compression_level: i32,
    overwrite: bool,
    backup: bool,
    ultra_brute: bool,
    include_subfolders: bool,
    force_compress: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            compression_level: 9,
            overwrite: true,
            backup: false,
            ultra_brute: false,
            include_subfolders: false,
            force_compress: false,
        }
    }
}

// ============================================================================
// 路径解析
// ============================================================================

fn get_config_path() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()?
        .parent()
        .map(|p| p.join("upx_gui_config.json"))
}

fn get_upx_path() -> Option<PathBuf> {
    // 1. 打包后的位置（安装版）
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let upx = exe_dir.join("_up_/upx/upx.exe");
            if upx.exists() {
                return Some(upx);
            }
        }
    }

    // 2. 开发环境
    let dev_upx = PathBuf::from("../upx/upx.exe");
    if dev_upx.exists() {
        return Some(dev_upx);
    }

    // 3. 便携版：从嵌入资源释放到临时目录
    extract_embedded_upx()
}

/// 从嵌入的二进制数据释放 UPX 到临时目录
fn extract_embedded_upx() -> Option<PathBuf> {
    // 使用 OnceLock 确保只释放一次
    EXTRACTED_UPX_PATH
        .get_or_init(|| {
            let temp_dir = std::env::temp_dir().join("upx-gui-portable");

            // 创建临时目录
            if fs::create_dir_all(&temp_dir).is_err() {
                return None;
            }

            let upx_path = temp_dir.join("upx.exe");

            // 如果文件已存在且大小匹配，直接使用
            if upx_path.exists() {
                if let Ok(metadata) = fs::metadata(&upx_path) {
                    if metadata.len() == EMBEDDED_UPX.len() as u64 {
                        return Some(upx_path);
                    }
                }
            }

            // 写入嵌入的 UPX 文件
            let mut file = fs::File::create(&upx_path).ok()?;
            file.write_all(EMBEDDED_UPX).ok()?;

            Some(upx_path)
        })
        .clone()
}

// ============================================================================
// 命令构建辅助
// ============================================================================

fn create_silent_command(upx_path: &PathBuf) -> Command {
    let mut cmd = Command::new(upx_path);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn build_compress_args(
    options: &UpxOptions,
    is_overwrite: bool,
) -> impl Iterator<Item = String> + '_ {
    let mut args = Vec::new();

    // 压缩级别
    if options.ultra_brute {
        args.push("--ultra-brute".to_string());
        args.push("--no-lzma".to_string());
    } else if options.compression_level == "best" {
        args.push("--best".to_string());
    } else {
        args.push(format!("-{}", options.compression_level));
    }

    // 强制压缩
    if options.force {
        args.push("--force".to_string());
    }

    // 输入输出
    args.push(options.input_file.clone());
    if !is_overwrite {
        args.push("-o".to_string());
        args.push(options.output_file.clone());
    }
    args.push("--force-overwrite".to_string());

    args.into_iter()
}

fn build_decompress_args(
    options: &UpxOptions,
    is_overwrite: bool,
) -> impl Iterator<Item = String> + '_ {
    let mut args = vec!["-d".to_string(), options.input_file.clone()];

    if options.force {
        args.push("--force".to_string());
    }

    if !is_overwrite {
        args.push("-o".to_string());
        args.push(options.output_file.clone());
    }
    args.push("--force-overwrite".to_string());

    args.into_iter()
}

// ============================================================================
// 输出处理
// ============================================================================

const IGNORED_PREFIXES: &[&str] = &[
    "---",
    "File size",
    "Ratio",
    "Format",
    "Name",
    "Ultimate Packer",
    "Copyright",
    "UPX ",
];

fn filter_output_lines(text: &str) -> Vec<&str> {
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            let should_keep = !IGNORED_PREFIXES
                .iter()
                .any(|prefix| trimmed.starts_with(prefix));
            should_keep.then_some(trimmed)
        })
        .collect()
}

fn format_upx_output(stdout: &str, stderr: &str) -> String {
    let combined = format!("{}{}", stdout, stderr);
    let lines = filter_output_lines(&combined);
    if lines.is_empty() {
        return String::new();
    }
    format!("\n\nUPX 输出:\n{}", lines.join("\n"))
}

fn parse_upx_error(stdout: &str, stderr: &str) -> String {
    let combined = format!("{}{}", stdout, stderr);

    let error_patterns: &[(&[&str], &str)] = &[
        (&["AlreadyPackedException", "already packed"], "[错误] 文件已经被 UPX 加壳过了\n\n解决方案:\n  - 如果要重新压缩，请先使用「脱壳解压」功能\n  - 或者选择其他未加壳的文件"),
        (&["NotPackedException", "not packed"], "[错误] 文件未被 UPX 加壳，无法脱壳\n\n解决方案:\n  - 请确认文件是否使用 UPX 加壳\n  - 或者选择「加壳压缩」功能"),
        (&["CantPackException"], "[错误] 无法压缩此文件\n\n可能原因:\n  - 文件格式不支持\n  - 文件已损坏\n  - 文件受保护（尝试启用「强制压缩」选项）"),
        (&["OverlayException"], "[错误] 文件包含附加数据（Overlay）\n\n解决方案:\n  - 某些文件在末尾附加了额外数据\n  - 尝试启用「强制压缩」选项\n  - 或使用其他工具移除附加数据"),
        (&["IOException", "can't open"], "[错误] 文件访问失败\n\n可能原因:\n  - 文件被其他程序占用\n  - 文件权限不足\n  - 文件路径包含特殊字符"),
        (&["NotCompressibleException"], "[错误] 文件无法压缩\n\n可能原因:\n  - 文件已经高度压缩\n  - 压缩后反而会变大\n  - UPX 自动跳过了此文件"),
    ];

    for (patterns, message) in error_patterns {
        if patterns.iter().any(|p| combined.contains(p)) {
            return message.to_string();
        }
    }

    // 通用错误信息
    let lines = filter_output_lines(&combined);
    if lines.is_empty() {
        return "[错误] UPX 处理失败\n\n请检查文件是否正常，或尝试其他选项".to_string();
    }
    format!("[错误] UPX 处理失败\n\n错误信息:\n{}", lines.join("\n"))
}

// ============================================================================
// 工具函数
// ============================================================================

fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} bytes", bytes)
    }
}

// ============================================================================
// UPX 处理核心
// ============================================================================

fn validate_upx_and_file(upx_path: &PathBuf, input_file: &str) -> Result<(), String> {
    // 检查 UPX 可用性
    create_silent_command(upx_path)
        .arg("--version")
        .output()
        .map_err(|_| "UPX 工具无法执行！".to_string())?;

    // 检查输入文件
    if !Path::new(input_file).exists() {
        return Err(format!("输入文件不存在: {}", input_file));
    }

    Ok(())
}

fn validate_file_writable(file: &str) -> Result<(), String> {
    let metadata = fs::metadata(file).map_err(|e| format!("无法读取文件属性: {}", e))?;
    if metadata.permissions().readonly() {
        return Err("文件为只读，请先修改文件属性".to_string());
    }
    Ok(())
}

fn create_backup(file: &str) -> Result<(), String> {
    let backup_path = format!("{}.bak", file);
    fs::copy(file, &backup_path)
        .map(|_| ())
        .map_err(|e| format!("备份文件失败: {}", e))
}

fn execute_upx(
    cmd: &mut Command,
    output_file: String,
    original_size: u64,
) -> Result<String, String> {
    let output = cmd
        .output()
        .map_err(|e| format!("执行 UPX 命令失败: {}", e))?;

    let (stdout, _, _) = GBK.decode(&output.stdout);
    let (stderr, _, _) = GBK.decode(&output.stderr);

    if output.status.success() {
        let output_size = fs::metadata(&output_file).map(|m| m.len()).unwrap_or(0);

        let ratio = if original_size > 0 {
            (output_size as f64 / original_size as f64 * 100.0) as i32
        } else {
            100
        };

        let upx_output = format_upx_output(&stdout, &stderr);

        Ok(format!(
            "操作成功!\n输出: {}\n原始大小: {}\n处理后大小: {}\n压缩率: {}%{}",
            output_file,
            format_bytes(original_size),
            format_bytes(output_size),
            ratio,
            upx_output
        ))
    } else {
        Err(parse_upx_error(&stdout, &stderr))
    }
}

#[tauri::command]
async fn process_upx(options: UpxOptions) -> Result<String, String> {
    let upx_path = get_upx_path().ok_or("未找到 UPX 工具！请确保安装完整")?;

    validate_upx_and_file(&upx_path, &options.input_file)?;

    let is_overwrite = options.input_file == options.output_file;
    if is_overwrite {
        validate_file_writable(&options.input_file)?;
    }

    if options.backup {
        create_backup(&options.input_file)?;
    }

    let original_size = fs::metadata(&options.input_file)
        .map(|m| m.len())
        .unwrap_or(0);

    let mut cmd = create_silent_command(&upx_path);

    match options.mode.as_str() {
        "compress" => {
            cmd.args(build_compress_args(&options, is_overwrite));
        }
        "decompress" => {
            cmd.args(build_decompress_args(&options, is_overwrite));
        }
        _ => return Err("未知的操作模式".to_string()),
    }

    let output_file_clone = options.output_file.clone();

    tokio::task::spawn_blocking(move || execute_upx(&mut cmd, output_file_clone, original_size))
        .await
        .map_err(|e| format!("任务执行错误: {}", e))?
}

// ============================================================================
// 文件夹扫描
// ============================================================================

const SUPPORTED_EXTENSIONS: &[&str] = &["exe", "dll"];

fn scan_folder_recursive(folder_path: &Path, include_subfolders: bool) -> Vec<String> {
    let mut files = Vec::new();

    if let Ok(entries) = fs::read_dir(folder_path) {
        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_dir() && include_subfolders {
                files.extend(scan_folder_recursive(&path, true));
            } else if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if SUPPORTED_EXTENSIONS.contains(&ext_lower.as_str()) {
                        if let Some(path_str) = path.to_str() {
                            files.push(path_str.to_string());
                        }
                    }
                }
            }
        }
    }

    files
}

#[tauri::command]
fn scan_folder(options: ScanFolderOptions) -> Result<Vec<String>, String> {
    let path = Path::new(&options.folder_path);

    if !path.exists() {
        return Err(format!("路径不存在: {}", options.folder_path));
    }

    if !path.is_dir() {
        return Err(format!("不是文件夹: {}", options.folder_path));
    }

    Ok(scan_folder_recursive(path, options.include_subfolders))
}

// ============================================================================
// UPX 版本查询
// ============================================================================

#[tauri::command]
fn get_upx_version() -> Result<String, String> {
    let upx_path = get_upx_path().ok_or("未找到 UPX 工具！")?;

    let output = create_silent_command(&upx_path)
        .arg("--version")
        .output()
        .map_err(|_| "UPX未找到".to_string())?;

    let (version_str, _, _) = GBK.decode(&output.stdout);
    version_str
        .lines()
        .next()
        .map(|s| s.to_string())
        .ok_or_else(|| "无法获取UPX版本".to_string())
}

// ============================================================================
// 图标缓存刷新（仅 Windows）
// ============================================================================

#[cfg(target_os = "windows")]
fn refresh_icon_cache_internal() {
    use std::env;

    // 关闭 Explorer
    let _ = Command::new("taskkill")
        .args(["/f", "/im", "explorer.exe"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    std::thread::sleep(std::time::Duration::from_millis(500));

    // 删除图标缓存
    if let Ok(userprofile) = env::var("USERPROFILE") {
        let cache_db = format!("{}\\AppData\\Local\\IconCache.db", userprofile);
        let _ = fs::remove_file(cache_db);

        // 删除缩略图缓存
        let explorer_path = format!(
            "{}\\AppData\\Local\\Microsoft\\Windows\\Explorer",
            userprofile
        );
        if let Ok(entries) = fs::read_dir(explorer_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("thumbcache_"))
                    .unwrap_or(false)
                {
                    let _ = fs::remove_file(path);
                }
            }
        }
    }

    std::thread::sleep(std::time::Duration::from_millis(500));

    // 重启 Explorer
    let _ = Command::new("explorer.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

#[tauri::command]
#[allow(dead_code)]
async fn refresh_icon_cache() -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        refresh_icon_cache_internal();
    })
    .await
    .ok();

    Ok(())
}

// ============================================================================
// 检查更新
// ============================================================================

const GITHUB_REPO: &str = "Y-ASLant/UPX-Tools";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

fn create_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("UPX-Tools/1.0")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

#[derive(Debug, Serialize, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    name: String,
    body: Option<String>,
    published_at: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Debug, Serialize)]
struct UpdateInfo {
    has_update: bool,
    current_version: String,
    latest_version: String,
    release_url: String,
    release_name: String,
    release_notes: String,
    published_at: String,
    download_url: Option<String>,
    download_size: Option<u64>,
}

#[tauri::command]
async fn check_update() -> Result<UpdateInfo, String> {
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );

    let client = create_http_client()?;

    // 构建请求
    let mut request = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");

    // 从环境变量读取 GitHub Token（如果存在，可提高 API 速率限制）
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        if !token.is_empty() {
            request = request.header("Authorization", format!("Bearer {}", token));
        }
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API 请求失败: {}", response.status()));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    // 移除版本号前的 'v' 前缀进行比较
    let latest = release.tag_name.trim_start_matches('v');
    let current = CURRENT_VERSION.trim_start_matches('v');

    let has_update = version_compare(latest, current);

    // 查找便携版或安装包下载链接
    let (download_url, download_size) = release
        .assets
        .iter()
        .find(|a| a.name.ends_with("-portable.exe") || a.name.ends_with("-setup.exe"))
        .map(|a| (Some(a.browser_download_url.clone()), Some(a.size)))
        .unwrap_or((None, None));

    Ok(UpdateInfo {
        has_update,
        current_version: format!("v{}", CURRENT_VERSION),
        latest_version: release.tag_name.clone(),
        release_url: release.html_url,
        release_name: release.name,
        release_notes: release.body.unwrap_or_default(),
        published_at: release.published_at,
        download_url,
        download_size,
    })
}

#[tauri::command]
async fn download_and_install(url: String, filename: String) -> Result<String, String> {
    let client = create_http_client()?;

    // 下载文件
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取下载内容失败: {}", e))?;

    // 保存到临时目录
    let temp_dir = std::env::temp_dir().join("upx-tools-update");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;

    let file_path = temp_dir.join(&filename);
    fs::write(&file_path, &bytes).map_err(|e| format!("保存文件失败: {}", e))?;

    // 运行安装程序
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", file_path.to_str().unwrap_or_default()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("启动安装程序失败: {}", e))?;
    }

    Ok(file_path.to_string_lossy().to_string())
}

/// 比较版本号，返回 latest > current
fn version_compare(latest: &str, current: &str) -> bool {
    let parse_version =
        |v: &str| -> Vec<u32> { v.split('.').filter_map(|s| s.parse().ok()).collect() };

    let latest_parts = parse_version(latest);
    let current_parts = parse_version(current);

    for i in 0..latest_parts.len().max(current_parts.len()) {
        let l = latest_parts.get(i).copied().unwrap_or(0);
        let c = current_parts.get(i).copied().unwrap_or(0);
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }
    false
}

// ============================================================================
// 配置持久化
// ============================================================================

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    let config_path = get_config_path().ok_or("无法获取配置文件路径")?;
    let json =
        serde_json::to_string_pretty(&config).map_err(|e| format!("序列化配置失败: {}", e))?;
    fs::write(&config_path, json).map_err(|e| format!("保存配置文件失败: {}", e))
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    let config_path = get_config_path().ok_or("无法获取配置文件路径")?;

    if !config_path.exists() {
        return Ok(AppConfig::default());
    }

    let json = fs::read_to_string(&config_path).map_err(|e| format!("读取配置文件失败: {}", e))?;

    serde_json::from_str(&json).map_err(|e| format!("解析配置文件失败: {}", e))
}

// ============================================================================
// Tauri 应用入口
// ============================================================================

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            process_upx,
            scan_folder,
            get_upx_version,
            refresh_icon_cache,
            save_config,
            load_config,
            check_update,
            download_and_install
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
