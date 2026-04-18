# electron/ — Main Process

Electron 主进程模块。负责 PTY 管理、进程监控、Git/FS 操作、Tray 驻留、配置持久化、Keychain 集成、Todo AI、终端缓冲持久化、系统资源监控。

**技术栈**: Node.js (Electron 31) / node-pty / child_process
**测试**: `node --test electron/*.test.js`（7 个测试文件）

## 架构

```
main.js (入口，模块组装)
  ├── config.js ← keychain.js
  ├── pty.js (PTY 生命周期 + 6 个共享状态 Map)
  ├── monitor.js ← pty.js + tools.js + resourceMonitor.js
  ├── git.js ← pty.js + gitStatus.js + pathValidator.js
  ├── fs-handlers.js (facade) ← fs-handlers-{browse,operations,image}.js
  │                              └── pathValidator.js
  ├── tools.js ← pty.js
  ├── tray.js ← pty.js
  ├── hookWatcher.js
  ├── todoAI.js ← keychain.js + tools.js
  └── terminalBuffer.js
preload.js (contextBridge 白名单)
```

## 共享状态（pty.js 导出的 6 个 Map）

| Map | 类型 | 用途 |
|-----|------|------|
| `ptyProcesses` | pid → pty | 活跃 PTY 进程 |
| `ptyMeta` | sessionId → {cols,rows,shell} | 终端元数据 |
| `sessionStatus` | sessionId → FSM 状态 | 进程监控状态机 |
| `sessionLaunchedTool` | sessionId → toolName | 区分"声明意图"vs `ps` 检测 |
| `notifyTimers` | sessionId → Timer | 完成通知 debounce |
| `sessionNames` | sessionId → name | 会话自定义名称 |

## IPC 注册模式

每个模块导出 `init*IPC()` 函数，在 `main.js` 的 `app.whenReady()` 中调用。`preload.js` 通过 `contextBridge.exposeInMainWorld` 镜像所有通道。

| 模块 | IPC 通道 |
|------|---------|
| main.js (initSystemIPC) | `system:homeDir`, `window:*`, `config:load/save`, `dialog:selectDir` |
| pty.js | `pty:create/write/resize/kill/insertText/launch`, `session:*`, `notifications:*` |
| monitor.js (push) | `session:status:{id}`, `session:responseComplete`, `system:resources` |
| git.js | `git:status/branches/log/fileDiff/scanRepos/runInSession` |
| fs-handlers-browse | `fs:listDir/exists/stat/reveal/openFile/readFilePreview` |
| fs-handlers-operations | `fs:writeFile/trash/rename/copy/move/zip/newFile/newFolder/importExternal` |
| fs-handlers-image | `fs:convertHeic/normalizeImage` |
| tools.js | `tools:catalog/checkAll/installInSession` |
| todoAI.js | `todo:chat:start/abort`, `todo:providers:available` + push streams |
| terminalBuffer.js | `buffer:save/load` |

## 关键约定

- **安全**: 命令执行一律 `execFile`（参数数组），禁止 `exec`/`shell=True`（CWE-78）
- **路径安全**: `pathValidator.js` 校验所有文件路径，禁止路径遍历和敏感目录访问
- **配置持久化**: `~/.ai-terminal-manager.json`（chmod 0o600，原子写 tmp+rename）
- **密钥存储**: macOS Keychain（service: `ai-terminal-manager`），config 文件中脱敏为 `***`
- **cleanupSession vs resetToolState**: AI 退出用 `resetToolState`（保留 pty），pty 退出用 `cleanupSession`（清除一切）
- **进程监控**: 1.5s BFS tick，`ps -axo pid=,ppid=,time=,rss=,command=` 单次快照 + 内存 BFS
- **通知**: 静默 > 3s → debounce 3.5s → 发通知；Stop hook 精确通知（sentinel 文件 + fs.watch）

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `main.js` | 336 | 应用入口：窗口创建、模块组装、系统 IPC |
| `preload.js` | 146 | IPC 安全桥（contextBridge 白名单） |
| `pty.js` | 357 | PTY 生命周期、共享状态、进程清理、session IPC |
| `monitor.js` | 329 | 进程监控 FSM、系统资源广播、通知 |
| `fs-handlers.js` | 31 | FS facade，委托 browse/operations/image 子模块 |
| `fs-handlers-browse.js` | 139 | 目录浏览/文件预览（6 IPC 通道） |
| `fs-handlers-operations.js` | 316 | 文件增删改/zip/导入（9 IPC 通道） |
| `fs-handlers-image.js` | 71 | HEIC/PNG 图片转换（macOS sips） |
| `git.js` | 163 | Git IPC handlers |
| `gitStatus.js` | 87 | `git status --porcelain` 解析器（纯函数） |
| `tray.js` | 105 | macOS 菜单栏驻留 |
| `config.js` | 132 | 配置持久化 + Keychain 迁移 |
| `keychain.js` | 248 | macOS Keychain 集成 |
| `pathValidator.js` | 116 | 文件路径安全校验 |
| `tools.js` | 184 | TOOL_CATALOG + PROVIDER_CATALOG + 安装 IPC |
| `hookWatcher.js` | 153 | Claude Code Stop hook 精确通知 |
| `todoAI.js` | 446 | AI TODO 助手流式 API（tool-use 循环） |
| `resourceMonitor.js` | 194 | CPU/MEM/Battery 采集（monitor 每 tick 调用） |
| `terminalBuffer.js` | 119 | 终端缓冲持久化（500KB/7天自动清理） |

## 测试覆盖

| 测试文件 | 覆盖模块 |
|---------|---------|
| `gitStatus.test.js` | gitStatus.js 解析器 |
| `keychain.test.js` | keychain.js 密钥管理 |
| `pathValidator.test.js` | pathValidator.js 路径校验 |
| `tools.test.js` | tools.js 目录结构完整性 |
| `config.test.js` | config.js 迁移/缓存/错误处理 |
| `monitor.test.js` | monitor.js FSM/BFS/正则/状态转换 |
| `fsImportExternal.test.js` | fs-handlers-operations.js 导入路径解析 |
