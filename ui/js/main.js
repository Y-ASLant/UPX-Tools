const { invoke } = window.__TAURI__.core
const { open, save } = window.__TAURI__.dialog
const { getCurrentWindow } = window.__TAURI__.window
const { listen } = window.__TAURI__.event

const appWindow = getCurrentWindow()

const PERFORMANCE_CONFIG = {
    cpuCores: navigator.hardwareConcurrency || 4,
    batchSize: null,
}

function calculateOptimalBatchSize() {
    const optimal = Math.max(2, Math.min(PERFORMANCE_CONFIG.cpuCores * 2, 16))
    PERFORMANCE_CONFIG.batchSize = optimal
    return optimal
}

// DOM 元素
const compressBtn = document.getElementById('compress-btn')
const decompressBtn = document.getElementById('decompress-btn')
const compressionLevel = document.getElementById('compression-level')
const levelDisplay = document.getElementById('level-display')
const levelDescription = document.getElementById('level-description')
const overwriteCheckbox = document.getElementById('overwrite')
const backupCheckbox = document.getElementById('backup')
const ultraBruteCheckbox = document.getElementById('ultra-brute')
const includeSubfoldersCheckbox = document.getElementById('include-subfolders')
const forceCompressCheckbox = document.getElementById('force-compress')
const logOutput = document.getElementById('log-output')
const settingsModal = document.getElementById('settings-modal')
const settingsBtn = document.getElementById('settings-btn')
const closeSettingsBtn = document.getElementById('close-settings')
const refreshIconBtn = document.getElementById('refresh-icon-btn')
const appTitle = document.getElementById('app-title')

// 窗口控制按钮
const minimizeBtn = document.getElementById('titlebar-minimize')
const maximizeBtn = document.getElementById('titlebar-maximize')
const closeBtn = document.getElementById('titlebar-close')

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化性能配置
    calculateOptimalBatchSize()

    initWindowControls()
    initOperationButtons()
    initCompressionLevelSlider()
    initTitleClick()
    preventRefresh()
    await setupDragAndDrop()

    // 加载保存的配置
    await loadSavedConfig()

    // 获取并显示UPX版本
    try {
        const version = await invoke('get_upx_version')
        // 在标题栏显示版本
        const versionElement = document.getElementById('upx-version')
        if (versionElement) {
            versionElement.textContent = `- ${version}`
        }
        addLog(`UPX GUI 已就绪 - ${version}`, 'info')
    } catch (error) {
        addLog('UPX GUI 已就绪 - 请选择操作', 'info')
    }

    // 页面加载完成后显示窗口，避免白屏
    setTimeout(async () => {
        await appWindow.show()
    }, 100)

    // 监听窗口大小变化，更新按钮位置缓存（使用防抖优化）
    let resizeTimer
    window.addEventListener(
        'resize',
        () => {
            clearTimeout(resizeTimer)
            resizeTimer = setTimeout(() => {
                cachedButtonRects = null // 清除缓存，下次使用时重新计算
            }, 150)
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
    minimizeBtn.addEventListener('click', () => {
        appWindow.minimize()
    })

    maximizeBtn.addEventListener('click', () => {
        appWindow.toggleMaximize()
    })

    closeBtn.addEventListener('click', () => {
        appWindow.close()
    })
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
    settingsBtn.addEventListener('click', showSettingsModal)
    closeSettingsBtn.addEventListener('click', handleCloseSettings)
    settingsModal.addEventListener('click', handleModalBackdropClick)

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
    const selectFile = mode === 'compress' ? handleCompress : handleDecompress

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
        addLog(`选择文件进行${modeName === '加壳压缩' ? '加壳' : '脱壳'}...`, 'info')
        await selectFile()
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

// 显示设置弹窗
function showSettingsModal() {
    settingsModal.classList.remove('hidden')
    // 强制重排以触发动画
    void settingsModal.offsetHeight
    settingsModal.classList.add('show')
}

// 隐藏设置弹窗
function hideSettingsModal() {
    settingsModal.classList.remove('show')
    // 等待动画结束后再隐藏
    setTimeout(() => {
        if (!settingsModal.classList.contains('show')) {
            settingsModal.classList.add('hidden')
        }
    }, 250)
}

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
    const { position } = event.payload
    updateDragVisual(position)
}

function handleDragOver(event) {
    const { position } = event.payload
    updateDragVisual(position)
}

function handleDragLeave() {
    compressBtn.classList.remove('drag-over')
    decompressBtn.classList.remove('drag-over')
}

function updateDragVisual(position) {
    const dropTarget = getDropTarget(position)

    if (dropTarget === 'compress') {
        compressBtn.classList.add('drag-over')
        decompressBtn.classList.remove('drag-over')
    } else if (dropTarget === 'decompress') {
        decompressBtn.classList.add('drag-over')
        compressBtn.classList.remove('drag-over')
    } else {
        compressBtn.classList.remove('drag-over')
        decompressBtn.classList.remove('drag-over')
    }
}

async function handleDragDrop(event) {
    const { paths, position } = event.payload

    // 移除拖拽视觉效果
    compressBtn.classList.remove('drag-over')
    decompressBtn.classList.remove('drag-over')

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

async function handleCompress() {
    await handleFileSelect('compress')
}

async function handleDecompress() {
    await handleFileSelect('decompress')
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
            ultra_brute: ultraBruteCheckbox.checked,
            force: forceCompressCheckbox.checked,
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
            ultra_brute: ultraBruteCheckbox.checked,
            include_subfolders: includeSubfoldersCheckbox.checked,
            force_compress: forceCompressCheckbox.checked,
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
    ultraBruteCheckbox.checked = config.ultra_brute
    includeSubfoldersCheckbox.checked = config.include_subfolders
    forceCompressCheckbox.checked = config.force_compress
    updateLevelDisplay(config.compression_level)
}

async function loadSavedConfig() {
    try {
        const config = await invoke('load_config')
        applyConfigToUI(config)
        addLog('已加载上次保存的配置', 'info')
    } catch (error) {
        console.error('加载配置失败:', error)
        addLog('使用默认配置', 'info')
    }
}
