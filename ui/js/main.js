const { invoke } = window.__TAURI__.core
const { open, save } = window.__TAURI__.dialog
const { getCurrentWindow } = window.__TAURI__.window
const { listen } = window.__TAURI__.event

const appWindow = getCurrentWindow()

// DOM 辅助函数
const $ = (id) => document.getElementById(id)

const PERFORMANCE_CONFIG = {
    cpuCores: navigator.hardwareConcurrency || 4,
    batchSize: Math.max(2, Math.min((navigator.hardwareConcurrency || 4) * 2, 16)),
}

// DOM 元素（延迟初始化）
let compressBtn,
    decompressBtn,
    compressionLevel,
    levelDisplay,
    levelDescription,
    overwriteCheckbox,
    backupCheckbox,
    lzmaCheckbox,
    ultraBruteCheckbox,
    includeSubfoldersCheckbox,
    forceCompressCheckbox,
    autoCheckUpdateCheckbox,
    logOutput,
    clearLogBtn,
    settingsModal,
    settingsBtn,
    closeSettingsBtn,
    refreshIconBtn,
    checkUpdateBtn,
    appTitle,
    minimizeBtn,
    maximizeBtn,
    closeBtn

// 初始化 DOM 元素
function initDOMElements() {
    compressBtn = $('compress-btn')
    decompressBtn = $('decompress-btn')
    compressionLevel = $('compression-level')
    levelDisplay = $('level-display')
    levelDescription = $('level-description')
    overwriteCheckbox = $('overwrite')
    backupCheckbox = $('backup')
    lzmaCheckbox = $('lzma')
    ultraBruteCheckbox = $('ultra-brute')
    includeSubfoldersCheckbox = $('include-subfolders')
    forceCompressCheckbox = $('force-compress')
    autoCheckUpdateCheckbox = $('auto-check-update')
    logOutput = $('log-output')
    clearLogBtn = $('clear-log-btn')
    settingsModal = $('settings-modal')
    settingsBtn = $('settings-btn')
    closeSettingsBtn = $('close-settings')
    refreshIconBtn = $('refresh-icon-btn')
    checkUpdateBtn = $('check-update-btn')
    appTitle = $('app-title')
    minimizeBtn = $('titlebar-minimize')
    maximizeBtn = $('titlebar-maximize')
    closeBtn = $('titlebar-close')
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    initDOMElements()
    initUpdateModal()
    initWindowControls()
    initOperationButtons()
    initCompressionLevelSlider()
    initTitleClick()
    preventRefresh()
    await setupDragAndDrop()
    await loadSavedConfig()

    // 获取并显示 UPX 版本
    try {
        const version = await invoke('get_upx_version')
        const versionElement = $('upx-version')
        if (versionElement) versionElement.textContent = `- ${version}`
        addLog(`UPX GUI 已就绪 - ${version}`, 'info')
    } catch {
        addLog('UPX GUI 已就绪 - 请选择操作', 'info')
    }

    // 页面加载完成后显示窗口
    setTimeout(() => appWindow.show(), 100)

    // 监听窗口大小变化，清除按钮位置缓存
    let resizeTimer
    window.addEventListener(
        'resize',
        () => {
            clearTimeout(resizeTimer)
            resizeTimer = setTimeout(() => (cachedButtonRects = null), 150)
        },
        { passive: true }
    )
})

function preventRefresh() {
    const BLOCKED_COMBINATIONS = [
        { key: 'F5', message: '刷新功能已禁用' },
        { ctrlKey: true, key: 'r', message: '刷新功能已禁用' },
        { ctrlKey: true, key: 'w', message: null },
    ]

    document.addEventListener(
        'keydown',
        (e) => {
            for (const combo of BLOCKED_COMBINATIONS) {
                const isMatch = combo.ctrlKey
                    ? e.ctrlKey && e.key.toLowerCase() === combo.key
                    : e.key === combo.key

                if (isMatch) {
                    e.preventDefault()
                    if (combo.message) addLog(combo.message, 'warning')
                    return false
                }
            }
        },
        { passive: false }
    )
}

// 窗口控制
function initWindowControls() {
    minimizeBtn.addEventListener('click', () => appWindow.minimize())
    maximizeBtn.addEventListener('click', () => appWindow.toggleMaximize())
    closeBtn.addEventListener('click', () => appWindow.close())
}

// 标题点击事件
function initTitleClick() {
    appTitle.addEventListener('click', async (e) => {
        // 阻止事件冒泡，避免触发拖动
        e.stopPropagation()

        try {
            // 使用 Tauri 的 shell 插件打开 URL
            const { open } = window.__TAURI__.shell
            await open('https://github.com/Y-ASLant/UPX-Tools')
            addLog('已在浏览器中打开 GitHub 仓库', 'info')
        } catch (error) {
            addLog(`打开链接失败: ${error}`, 'error')
        }
    })
}

function initOperationButtons() {
    refreshIconBtn.addEventListener('click', handleRefreshIcon)
    checkUpdateBtn.addEventListener('click', handleCheckUpdate)
    settingsBtn.addEventListener('click', showSettingsModal)
    closeSettingsBtn.addEventListener('click', handleCloseSettings)
    settingsModal.addEventListener('click', handleModalBackdropClick)
    clearLogBtn.addEventListener('click', handleClearLog)

    compressBtn.addEventListener('click', () => handleOperationClick('compress'))
    decompressBtn.addEventListener('click', () => handleOperationClick('decompress'))
}

async function handleCloseSettings() {
    await saveCurrentConfig()
    hideSettingsModal()
    addLog('设置已保存', 'success')
}

async function handleModalBackdropClick(e) {
    if (e.target === settingsModal) {
        await saveCurrentConfig()
        hideSettingsModal()
    }
}

async function handleOperationClick(mode) {
    const modeName = mode === 'compress' ? '加壳压缩' : '脱壳解压'
    const processFile = mode === 'compress' ? handleCompressWithFile : handleDecompressWithFile

    if (window.droppedFiles?.length > 0) {
        const files = window.droppedFiles
        window.droppedFiles = null
        addLog(`开始批量${modeName}...`, 'info')
        await processBatchFiles(files, mode)
    } else if (window.droppedFile) {
        const filePath = window.droppedFile
        window.droppedFile = null
        addLog(`开始${modeName}...`, 'info')
        await processFile(filePath)
    } else {
        addLog(`选择文件进行${mode === 'compress' ? '加壳' : '脱壳'}...`, 'info')
        await handleFileSelect(mode)
    }
}

// 级别描述映射（全局常量）
const LEVEL_DESCRIPTIONS = {
    1: '最快速度，压缩率最低',
    2: '较快速度，较低压缩率',
    3: '快速压缩',
    4: '平衡模式',
    5: '标准压缩',
    6: '良好压缩',
    7: '较高压缩率',
    8: '高压缩率',
    9: '推荐级别，平衡速度和压缩率',
    10: '极致压缩，速度最慢',
}

// 更新压缩级别显示
function updateLevelDisplay(value) {
    const level = parseInt(value)
    levelDisplay.textContent = level === 10 ? '级别 best' : `级别 ${level}`
    levelDescription.textContent = LEVEL_DESCRIPTIONS[level] || ''
}

// 初始化压缩级别滑动条
function initCompressionLevelSlider() {
    updateLevelDisplay(compressionLevel.value)
    compressionLevel.addEventListener('input', (e) => updateLevelDisplay(e.target.value))
}

// 获取当前压缩级别值
function getCompressionLevel() {
    const value = parseInt(compressionLevel.value)
    return value === 10 ? 'best' : value.toString()
}

// 通用弹窗控制
function showModal(modal) {
    modal.classList.remove('hidden')
    void modal.offsetHeight // 强制重排以触发动画
    modal.classList.add('show')
}

function hideModal(modal) {
    modal.classList.remove('show')
    setTimeout(() => {
        if (!modal.classList.contains('show')) modal.classList.add('hidden')
    }, 250)
}

const showSettingsModal = () => showModal(settingsModal)
const hideSettingsModal = () => hideModal(settingsModal)

// 扫描文件夹获取所有exe和dll文件
async function scanFolder(folderPath, includeSubfolders) {
    try {
        const files = await invoke('scan_folder', {
            options: {
                folder_path: folderPath,
                include_subfolders: includeSubfolders,
            },
        })
        return files
    } catch (error) {
        addLog(`扫描文件夹失败: ${error}`, 'error')
        return []
    }
}

async function processBatchFiles(files, mode) {
    if (files.length === 0) {
        addLog('没有找到可处理的文件', 'warning')
        return
    }

    addLog(`批量处理模式 - 找到 ${files.length} 个文件`, 'info')
    addLog(
        `使用 ${PERFORMANCE_CONFIG.batchSize} 并发处理（CPU核心: ${PERFORMANCE_CONFIG.cpuCores}）`,
        'info'
    )

    const handler = mode === 'compress' ? handleCompressWithFile : handleDecompressWithFile
    let successCount = 0
    let failCount = 0
    const batchSize = PERFORMANCE_CONFIG.batchSize

    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, Math.min(i + batchSize, files.length))
        addLog(
            `处理进度: ${i + 1}-${Math.min(i + batchSize, files.length)}/${files.length}`,
            'info'
        )

        await Promise.all(
            batch.map(async (file) => {
                try {
                    await handler(file)
                    successCount++
                } catch {
                    addLog(`处理失败: ${file}`, 'error')
                    failCount++
                }
            })
        )

        await new Promise((resolve) => setTimeout(resolve, 0))
    }

    addLog(`批量处理完成! 成功: ${successCount} 个，失败: ${failCount} 个`, 'success', true)
}

async function checkAndScanPath(path) {
    const files = await scanFolder(path, includeSubfoldersCheckbox.checked)

    if (files.length > 0) {
        addLog(`扫描文件夹: ${path} (找到 ${files.length} 个文件)`, 'info')
        return files
    }

    const extension = path.toLowerCase()
    if (extension.endsWith('.exe') || extension.endsWith('.dll')) {
        return [path]
    }

    return []
}

async function setupDragAndDrop() {
    await listen('tauri://drag-drop', handleDragDrop)
    await listen('tauri://drag-enter', handleDragEnter)
    await listen('tauri://drag-over', handleDragOver)
    await listen('tauri://drag-leave', handleDragLeave)
}

function handleDragEnter(event) {
    updateDragVisual(event.payload.position)
}

function handleDragOver(event) {
    updateDragVisual(event.payload.position)
}

function handleDragLeave() {
    clearDragVisual()
}

function clearDragVisual() {
    compressBtn.classList.remove('drag-over')
    decompressBtn.classList.remove('drag-over')
}

function updateDragVisual(position) {
    const dropTarget = getDropTarget(position)
    compressBtn.classList.toggle('drag-over', dropTarget === 'compress')
    decompressBtn.classList.toggle('drag-over', dropTarget === 'decompress')
}

async function handleDragDrop(event) {
    const { paths, position } = event.payload
    clearDragVisual()

    if (!paths?.length) return

    const allFiles = await collectFiles(paths)
    if (allFiles.length === 0) {
        addLog('未找到 .exe 或 .dll 文件', 'warning')
        return
    }

    await processDropByTarget(allFiles, position)
}

async function collectFiles(paths) {
    const allFiles = []
    for (const path of paths) {
        const files = await checkAndScanPath(path)
        allFiles.push(...files)
    }
    return allFiles
}

async function processDropByTarget(files, position) {
    const dropTarget = getDropTarget(position)

    if (dropTarget === 'compress') {
        addLog('检测到拖放至加壳区域', 'info')
        await processBatchFiles(files, 'compress')
    } else if (dropTarget === 'decompress') {
        addLog('检测到拖放至脱壳区域', 'info')
        await processBatchFiles(files, 'decompress')
    } else {
        storeFilesForLater(files)
    }
}

function storeFilesForLater(files) {
    if (files.length === 1) {
        addLog('请点击"加壳压缩"或"脱壳解压"按钮', 'info')
        window.droppedFile = files[0]
    } else {
        addLog(`已选择 ${files.length} 个文件，请点击操作按钮`, 'info')
        window.droppedFiles = files
    }
}

// 缓存按钮位置信息
let cachedButtonRects = null

// 更新按钮位置缓存
function updateButtonRectsCache() {
    cachedButtonRects = {
        compress: compressBtn.getBoundingClientRect(),
        decompress: decompressBtn.getBoundingClientRect(),
    }
}

function isPointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function getDropTarget(position) {
    if (!position) return null

    if (!cachedButtonRects) {
        updateButtonRectsCache()
    }

    const { x, y } = position

    if (isPointInRect(x, y, cachedButtonRects.compress)) {
        return 'compress'
    }

    if (isPointInRect(x, y, cachedButtonRects.decompress)) {
        return 'decompress'
    }

    return null
}

async function handleFileSelect(mode) {
    try {
        const selected = await open({
            multiple: true,
            filters: [{ name: '可执行文件', extensions: ['exe', 'dll'] }],
        })

        if (!selected || (Array.isArray(selected) && selected.length === 0)) {
            addLog('未选择文件', 'warning')
            return
        }

        const files = Array.isArray(selected) ? selected : [selected]

        if (files.length === 1) {
            addLog(`选择文件: ${files[0]}`, 'info')
            const handler = mode === 'compress' ? handleCompressWithFile : handleDecompressWithFile
            await handler(files[0])
        } else {
            addLog(`选择了 ${files.length} 个文件`, 'info')
            await processBatchFiles(files, mode)
        }
    } catch (error) {
        addLog(`操作失败: ${error}`, 'error')
    }
}

async function handleCompressWithFile(inputFile) {
    try {
        let outputFile

        if (overwriteCheckbox.checked) {
            outputFile = inputFile
            addLog('将覆盖原文件', 'info')
        } else {
            const ext = inputFile.substring(inputFile.lastIndexOf('.'))
            const baseName = inputFile.substring(0, inputFile.lastIndexOf('.'))
            const defaultOutput = `${baseName}_packed${ext}`

            outputFile = await save({
                filters: [{ name: '可执行文件', extensions: ['exe', 'dll'] }],
                defaultPath: defaultOutput,
            })

            if (!outputFile) {
                addLog('未选择输出位置', 'warning')
                return
            }

            addLog(`输出文件: ${outputFile}`, 'info')
        }

        await processUpx('compress', inputFile, outputFile)
    } catch (error) {
        addLog(`操作失败: ${error}`, 'error')
    }
}

async function handleDecompressWithFile(inputFile) {
    try {
        addLog('将覆盖原文件', 'info')
        await processUpx('decompress', inputFile, inputFile)
    } catch (error) {
        addLog(`操作失败: ${error}`, 'error')
    }
}

async function processUpx(mode, inputFile, outputFile) {
    try {
        const options = {
            mode,
            input_file: inputFile,
            output_file: outputFile,
            compression_level: getCompressionLevel(),
            backup: backupCheckbox.checked,
            lzma: lzmaCheckbox.checked,
            ultra_brute: ultraBruteCheckbox.checked,
            force: forceCompressCheckbox.checked,
        }

        if (lzmaCheckbox.checked) {
            addLog('已启用 LZMA 压缩', 'info')
        }

        if (ultraBruteCheckbox.checked) {
            addLog('已启用极限压缩模式', 'info')
        }

        if (forceCompressCheckbox.checked) {
            addLog('已启用强制压缩模式', 'warning')
        }

        const actionName = mode === 'compress' ? '加壳压缩' : '脱壳解压'
        addLog(`开始${actionName}...`, 'info')

        const result = await invoke('process_upx', { options })
        parseProcessResult(result)
    } catch (error) {
        parseProcessError(String(error))
    }
}

function parseProcessResult(result) {
    const LOG_PATTERNS = [
        { patterns: ['操作成功', '操作完成'], type: 'success', highlight: true },
        { patterns: ['输出:', '大小:', '压缩率:'], type: 'success', highlight: false },
        { patterns: ['UPX 输出:'], type: 'info', highlight: false },
        { patterns: ['扫描', '检测'], type: 'warning', highlight: false },
    ]

    result.split('\n').forEach((line) => {
        if (!line.trim()) return

        const match = LOG_PATTERNS.find(({ patterns }) => patterns.some((p) => line.includes(p)))

        if (match) {
            addLog(line, match.type, match.highlight)
        } else {
            addLog(line, 'info')
        }
    })
}

function parseProcessError(errorMsg) {
    const ERROR_PATTERNS = [
        { test: (s) => s.includes('[错误]'), type: 'error' },
        { test: (s) => s.includes('解决方案:') || s.includes('可能原因:'), type: 'warning' },
        { test: (s) => s.trim().startsWith('-'), type: 'hint' },
    ]

    errorMsg.split('\n').forEach((line, index) => {
        if (!line.trim()) return

        const match = ERROR_PATTERNS.find(({ test }) => test(line))

        if (match) {
            addLog(line, match.type)
        } else {
            addLog(line, index === 0 ? 'error' : 'hint')
        }
    })
}

// 刷新图标缓存
async function handleRefreshIcon() {
    try {
        addLog('正在刷新图标缓存...', 'info')
        await invoke('refresh_icon_cache')
        addLog('图标缓存刷新完成', 'success')
    } catch (error) {
        addLog(`刷新失败: ${error}`, 'error')
    }
}

// 清空日志
function handleClearLog() {
    logOutput.innerHTML = '<div class="text-muted-foreground/50">日志已清空</div>'
}

// 更新弹窗相关元素（延迟初始化）
let updateModal,
    updateVersion,
    updateDate,
    updateNotes,
    updateProgress,
    updateProgressText,
    updateProgressBar,
    updateLaterBtn,
    downloadOptions

// 当前更新信息缓存
let currentUpdateInfo_ = null

// 初始化更新弹窗元素和事件
function initUpdateModal() {
    updateModal = $('update-modal')
    updateVersion = $('update-version')
    updateDate = $('update-date')
    updateNotes = $('update-notes')
    updateProgress = $('update-progress')
    updateProgressText = $('update-progress-text')
    updateProgressBar = $('update-progress-bar')
    updateLaterBtn = $('update-later-btn')
    downloadOptions = $('download-options')

    updateLaterBtn?.addEventListener('click', hideUpdateModal)
    updateModal?.addEventListener('click', (e) => {
        if (e.target === updateModal) hideUpdateModal()
    })
}

// 检查更新
async function handleCheckUpdate() {
    try {
        addLog('正在检查更新...', 'info')
        checkUpdateBtn.disabled = true

        const updateInfo = await invoke('check_update')

        if (updateInfo.has_update) {
            addLog(`发现新版本: ${updateInfo.latest_version}`, 'success', true)
            currentUpdateInfo_ = updateInfo
            showUpdateModal(updateInfo)
        } else {
            addLog(`当前已是最新版本 (${updateInfo.current_version})`, 'success')
        }
    } catch (error) {
        addLog(`检查更新失败: ${error}`, 'error')
    } finally {
        checkUpdateBtn.disabled = false
    }
}

// 简单的 Markdown 渲染
function renderMarkdown(text) {
    if (!text) return '<div>暂无更新说明</div>'

    // 移除图片和 HTML 标签
    let cleaned = text
        .replace(/!\[.*?\]\(.*?\)/g, '')
        .replace(/<img[^>]*>/g, '')
        .replace(/<[^>]+>/g, '')
        .trim()

    // 按行处理
    const lines = cleaned.split('\n')
    const result = []

    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        // 列表项
        if (/^[-*]\s+/.test(trimmed)) {
            const content = trimmed.replace(/^[-*]\s+/, '')
            result.push(
                `<div class="flex gap-2"><span>•</span><span>${formatInline(content)}</span></div>`
            )
        }
        // 标题
        else if (/^###\s+/.test(trimmed)) {
            result.push(
                `<div class="font-medium text-foreground">${trimmed.replace(/^###\s+/, '')}</div>`
            )
        } else if (/^##\s+/.test(trimmed)) {
            result.push(
                `<div class="font-semibold text-foreground">${trimmed.replace(/^##\s+/, '')}</div>`
            )
        } else if (/^#\s+/.test(trimmed)) {
            result.push(
                `<div class="font-bold text-foreground">${trimmed.replace(/^#\s+/, '')}</div>`
            )
        }
        // 普通文本
        else {
            result.push(`<div>${formatInline(trimmed)}</div>`)
        }
    }

    return result.length > 0 ? result.join('') : '<div>暂无更新说明</div>'
}

// 处理行内格式
function formatInline(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code class="bg-secondary/50 px-1 rounded text-xs">$1</code>')
        .replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            '<a href="$2" class="text-primary hover:underline" target="_blank">$1</a>'
        )
}

// 显示更新弹窗
function showUpdateModal(info) {
    updateVersion.textContent = `${info.current_version} → ${info.latest_version}`
    updateDate.textContent = `发布于 ${formatDate(info.published_at)}`
    updateNotes.innerHTML = renderMarkdown(info.release_notes)

    // 重置进度条状态
    updateProgress.classList.add('hidden')
    updateProgressBar.style.width = '0%'
    updateProgressText.textContent = '0%'

    // 渲染下载选项
    renderDownloadOptions(info.assets)

    showModal(updateModal)
}

// 渲染下载选项
function renderDownloadOptions(assets) {
    if (!downloadOptions) return

    const optionLabels = {
        'portable.exe': '便携版',
        'setup.exe': '安装版',
    }

    downloadOptions.innerHTML = assets
        .filter((asset) => {
            // 只显示便携版和安装版
            return asset.name.includes('portable.exe') || asset.name.includes('setup.exe')
        })
        .map((asset) => {
            const label =
                Object.entries(optionLabels).find(([key]) => asset.name.includes(key))?.[1] ||
                asset.name

            return `
                <button
                    class="download-option-btn btn btn-outline py-2.5 px-4 text-sm rounded-sm"
                    data-url="${asset.browser_download_url}"
                    data-filename="${asset.name}"
                >
                    ${label}
                </button>
            `
        })
        .join('')

    // 绑定点击事件
    downloadOptions.querySelectorAll('.download-option-btn').forEach((btn) => {
        btn.addEventListener('click', handleDownloadOption)
    })
}

// 下载选中的版本
async function handleDownloadOption(e) {
    const url = e.target.dataset.url
    const filename = e.target.dataset.filename

    if (!url) return

    try {
        // 禁用所有下载按钮
        downloadOptions
            .querySelectorAll('.download-option-btn')
            .forEach((btn) => (btn.disabled = true))

        updateProgress.classList.remove('hidden')

        // 模拟进度
        let progress = 0
        const progressInterval = setInterval(() => {
            progress += Math.random() * 15
            if (progress > 90) progress = 90
            updateProgressBar.style.width = `${progress}%`
            updateProgressText.textContent = `${Math.round(progress)}%`
        }, 200)

        addLog(`正在下载: ${filename}`, 'info')
        const filePath = await invoke('download_and_install', {
            url,
            filename,
        })

        clearInterval(progressInterval)
        updateProgressBar.style.width = '100%'
        updateProgressText.textContent = '100%'

        addLog(`下载完成: ${filePath}`, 'success')
        addLog('正在启动安装程序...', 'info')

        setTimeout(() => {
            hideUpdateModal()
            addLog('安装程序已启动，请按提示完成安装', 'success', true)
        }, 1000)
    } catch (error) {
        addLog(`下载失败: ${error}`, 'error')
        // 恢复按钮状态
        downloadOptions
            .querySelectorAll('.download-option-btn')
            .forEach((btn) => (btn.disabled = false))
    }
}

const hideUpdateModal = () => hideModal(updateModal)

// 格式化日期
function formatDate(isoString) {
    try {
        const date = new Date(isoString)
        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        })
    } catch {
        return isoString
    }
}

// 日志初始化标志
let logInitialized = false

// 日志管理配置
const LOG_CONFIG = {
    MAX_LOGS: 1000, // 最大日志条数
    TRIM_COUNT: 200, // 超出时一次删除的条数
}

// 添加日志
function addLog(message, type = 'info', highlight = false) {
    const logLine = document.createElement('div')
    logLine.className = `log-line log-${type} fade-in${highlight ? ' log-highlight' : ''}`

    const timestamp = new Date().toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })

    logLine.textContent = `[${timestamp}] ${message}`

    // 清除初始提示（只执行一次）
    if (!logInitialized) {
        logOutput.innerHTML = ''
        logInitialized = true
    }

    logOutput.appendChild(logLine)

    // 日志数量管理：超过最大值时删除旧日志
    const logCount = logOutput.children.length
    if (logCount > LOG_CONFIG.MAX_LOGS) {
        // 批量删除旧日志以提升性能
        for (let i = 0; i < LOG_CONFIG.TRIM_COUNT; i++) {
            if (logOutput.firstChild) {
                logOutput.removeChild(logOutput.firstChild)
            }
        }
    }

    // 使用 requestAnimationFrame 优化滚动性能
    requestAnimationFrame(() => {
        logOutput.scrollTop = logOutput.scrollHeight
    })
}

async function saveCurrentConfig() {
    try {
        const config = {
            compression_level: parseInt(compressionLevel.value),
            overwrite: overwriteCheckbox.checked,
            backup: backupCheckbox.checked,
            lzma: lzmaCheckbox.checked,
            ultra_brute: ultraBruteCheckbox.checked,
            include_subfolders: includeSubfoldersCheckbox.checked,
            force_compress: forceCompressCheckbox.checked,
            auto_check_update: autoCheckUpdateCheckbox.checked,
        }

        await invoke('save_config', { config })
    } catch (error) {
        console.error('保存配置失败:', error)
    }
}

function applyConfigToUI(config) {
    compressionLevel.value = config.compression_level
    overwriteCheckbox.checked = config.overwrite
    backupCheckbox.checked = config.backup
    lzmaCheckbox.checked = config.lzma || false
    ultraBruteCheckbox.checked = config.ultra_brute
    includeSubfoldersCheckbox.checked = config.include_subfolders
    forceCompressCheckbox.checked = config.force_compress
    autoCheckUpdateCheckbox.checked = config.auto_check_update !== false
    updateLevelDisplay(config.compression_level)
}

async function loadSavedConfig() {
    try {
        const config = await invoke('load_config')
        applyConfigToUI(config)
        addLog('已加载上次保存的配置', 'info')

        // 根据配置决定是否自动检查更新
        if (config.auto_check_update !== false) {
            setTimeout(() => handleCheckUpdate(), 1000)
        }
    } catch (error) {
        console.error('加载配置失败:', error)
        addLog('使用默认配置', 'info')
        // 默认自动检查更新
        setTimeout(() => handleCheckUpdate(), 1000)
    }
}
