# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 智枢 ZhiShu - AI Terminal Manager

> 多 Agent AI 编程终端统一指挥台。在一个桌面应用内管理 Claude Code / Codex / Gemini CLI / Qwen / OpenCode / GLM / MiniMax / Kimi 等 8 款 AI CLI 工具。

**技术栈**: Electron 31 + React 18 + xterm.js (WebGL) + Zustand + node-pty
**平台**: macOS (当前唯一支持)
**协议**: MIT | **作者**: Xuuuuu04

---

## 常用命令

```bash
npm start                 # 开发模式 (React dev server + Electron)
npm test                  # 运行所有测试 (Node.js 内置 test runner)
npm run package           # 生产构建 (.dmg/.zip/.app)
npm run verify:desktop    # 验证打包链路（不产完整安装包）
npm run rebuild-native    # 重编译 node-pty（Electron 版本更新后必须）
```

运行单个测试文件：

```bash
node --test electron/gitStatus.test.js
node --test electron/monitor.test.js
node --test electron/tools.test.js
node --test electron/config.test.js
node --test electron/keychain.test.js
node --test electron/pathValidator.test.js
node --test electron/fsImportExternal.test.js
node --test src/store/sessionState.test.js
```

---

## 架构总览

```mermaid
graph TB
    subgraph "Main Process (Node.js)"
        MW[BrowserWindow]
        PTY[node-pty<br/>进程管理]
        MON[Process Monitor<br/>1.5s BFS tick]
        RES[Resource Monitor<br/>CPU/MEM/BAT]
        BUF[Terminal Buffer<br/>持久化 500KB/7天]
        GIT[Git Wrapper]
        FS[FS Handlers<br/>browse/ops/image]
        CFG[Config + Keychain]
        TRAY[Tray / Menu Bar]
        HOOK[Hook Watcher<br/>Stop hook 精确通知]
        TODO[AI TODO 助手]
    end

    subgraph "IPC Bridge (contextIsolation)"
        PRE[preload.js<br/>白名单 API]
    end

    subgraph "Renderer Process (React)"
        ZS[Zustand Store]
        SB[Sidebar + 分组系统]
        TV[TerminalView + ToolSelector + ResourceBar]
        SC[SplitContainer]
        GP[GitPanel]
        FTP[FileTreePanel]
        FPP[FilePreviewPanel]
        SM[SettingsModal<br/>5-tab]
        TP[TodoPanel + AI Chat]
        CP[CommandPalette]
        TS[ToastStack]
    end

    MW --> PRE
    PTY --> PRE
    MON --> PRE
    RES --> MON
    BUF --> PRE
    GIT --> PRE
    FS --> PRE
    CFG --> PRE
    HOOK --> PRE
    TODO --> PRE
    PRE --> ZS
    ZS --> SB
    ZS --> TV
    ZS --> GP
    ZS --> FTP
    ZS --> FPP
    ZS --> SM
    ZS --> TP
    ZS --> TS
    ZS --> SC
```

## 模块索引

| 模块 | 路径 | 职责 | 详情 |
|------|------|------|------|
| **主进程** | `electron/` | pty 管理、进程监控、Git/FS 操作、Tray、资源监控 | [electron/CLAUDE.md](electron/CLAUDE.md) |
| **渲染进程** | `src/` | React UI、Zustand 状态管理、xterm.js 终端 | [src/CLAUDE.md](src/CLAUDE.md) |
| **组件库** | `src/components/` | 所有 React 组件 | [src/components/CLAUDE.md](src/components/CLAUDE.md) |
| **状态管理** | `src/store/` | Zustand store + 纯函数 | [src/store/CLAUDE.md](src/store/CLAUDE.md) |
| **侧边栏** | `src/components/sidebar/` | 项目/会话子组件 | [src/components/sidebar/CLAUDE.md](src/components/sidebar/CLAUDE.md) |
| **设置** | `src/components/settings/` | 设置子组件 | [src/components/settings/CLAUDE.md](src/components/settings/CLAUDE.md) |
| **CI/CD** | `.github/workflows/` | GitHub Actions：测试 + 原生模块 + 桌面包包 | ci.yml |
| **构建资产** | `build-assets/` | SVG 图标源文件 → .icns | BUILD.md |
| **构建文档** | `BUILD.md` | 图标工作流、打包配置、Gatekeeper 绕过 | BUILD.md |

## 全局开发规范

### 进程边界
- **所有** pty / 文件系统 / git 操作必须在 Main 进程，Renderer 只通过 `window.electronAPI` (IPC) 调用
- `contextIsolation: true` + `nodeIntegration: false` — 不在 Renderer 中直接使用 Node.js API
- 新增 IPC handler 时必须在 `preload.js` 同步暴露

### 安全
- 命令执行一律用 `execFile`（参数数组），禁止 `exec` / `shell=True`（防 CWE-78）
- 文件路径不允许用户控制完整路径（`pathValidator.js` 校验，防 CWE-22）
- Provider API Key 存储在 `~/.ai-terminal-manager.json` 中脱敏为 `***`，真实密钥通过 macOS Keychain 存取

### 状态管理
- **唯一状态源**: `src/store/sessions.js` (Zustand store)
- 纯函数抽取到 `src/store/sessionState.js`（可独立测试）
- 持久化到 `~/.ai-terminal-manager.json`，通过 `persist()` 方法显式触发

### 进程监控状态机
```
not_started → idle_no_instruction → running → awaiting_review
     ↑              ↑                 ↑              │
     └──────────────┴─────────────────┴──────────────┘
```
- `not_started`: 无 AI 进程
- `idle_no_instruction`: AI 已启动，用户未发指令
- `running`: 用户已发指令，AI 正在输出（静默 < 3s）
- `awaiting_review`: AI 输出静默 > 3s → debounce 3.5s → 发通知

### Provider 系统
GLM / MiniMax / Kimi 复用 Claude 二进制 + 环境变量注入（`ANTHROPIC_BASE_URL`）：
- `sessionLaunchedTool` Map 区分 "声明意图" vs `ps` 检测结果
- POSIX 单引号转义：`'` → `'\''`
- Provider 配置合并：用户覆盖 (`providerConfigs`) + 目录默认值 (`PROVIDER_CATALOG.defaults`) + 自定义 (`customProviders`)

### 会话自动恢复
- 启动时读取每个 session 的 `lastTool` → 延迟 1.2s 注入 `--continue` 命令
- `autoRestoreSessions` 开关控制（默认开启）

### pty 生命周期
- React 18 strict mode 会 double-mount useEffect → `createPty` 必须 reuse 已有 pty
- 删除 session 时 `killPtyTree` 递归 SIGKILL 整个进程树（不只是 SIGHUP shell）
- `collectDescendants` 用同步 `execFileSync`（before-quit 不可 await）
- AI 退出用 `resetToolState()`（保留 pty），pty 退出用 `cleanupSession()`（清除一切）

### 测试
- 运行: `npm test`（Node.js 内置 test runner）
- 8 个测试文件覆盖：gitStatus, keychain, pathValidator, tools, config, monitor, fsImportExternal, sessionState
- 仅纯函数和可 mock 的模块可测（Main 进程的 pty/Git 依赖 Node.js 运行时，Renderer 依赖 DOM）

### 关键技术决策
1. **Electron 而非 Tauri**: node-pty 是 Node native addon，Tauri (Rust) 需重写整个 pty 层
2. **Zustand 而非 Redux**: 无 Provider / boilerplate，适合中等复杂度桌面应用
3. **`ps -axo` BFS 而非 pgrep 循环**: 单次快照 + 内存 BFS 比多次 shell-out 高效 10 倍
4. **通知 debounce 3.5s**: 避免 tool-call 暂停（1-3s）误触发完成通知
5. **ImageAddon 禁用**: xterm.js #4793 dispose race condition，等上游修复
6. **WebGL addon 单独 dispose**: 时序敏感，不走 AddonManager 批量 dispose
7. **窗口状态持久化**: `main.js` 保存/恢复窗口 bounds 和 maximized 状态
8. **分屏 (SplitContainer)**: 同一项目下可左右/上下分屏，ratio 0.2-0.8 可调
9. **Stop Hook 精确通知 (hookWatcher)**: sentinel 文件 + fs.watch 即时检测
10. **TODO AI 助手 (todoAI)**: Anthropic-format 流式 API 多轮对话 + tool_use 循环
11. **终端缓冲持久化 (terminalBuffer)**: SerializeAddon → `~/.ai-terminal-manager/buffers/`，500KB/7天
12. **系统资源监控 (resourceMonitor)**: CPU delta + RSS + heap + battery，piggyback on monitor tick
13. **fs-handlers 拆分**: browse（只读）/ operations（增删改）/ image（转换）三子模块 + facade

## 项目结构

```
ai-terminal-manager/
├── electron/
│   ├── main.js                # 应用入口：生命周期 + 窗口 + 模块组装
│   ├── preload.js             # IPC 安全桥
│   ├── pty.js                 # PTY 生命周期、共享状态、进程清理
│   ├── monitor.js             # 进程监控 FSM（1.5s BFS tick）
│   ├── resourceMonitor.js     # 系统资源采集（CPU/MEM/BAT）
│   ├── terminalBuffer.js      # 终端缓冲持久化（500KB/7天）
│   ├── git.js                 # Git IPC handlers
│   ├── gitStatus.js           # git status 解析器（纯函数）
│   ├── fs-handlers.js         # FS facade（委托 browse/ops/image）
│   ├── fs-handlers-browse.js  # 目录浏览/文件预览
│   ├── fs-handlers-operations.js # 文件增删改/zip/导入
│   ├── fs-handlers-image.js   # HEIC/PNG 转换（macOS sips）
│   ├── config.js              # 配置持久化 + Keychain 迁移
│   ├── keychain.js            # macOS Keychain 集成
│   ├── pathValidator.js       # 文件路径安全校验
│   ├── tools.js               # 工具目录 + Provider 目录 + 安装 IPC
│   ├── tray.js                # macOS 菜单栏驻留
│   ├── hookWatcher.js         # Claude Code Stop hook 精确通知
│   ├── todoAI.js              # AI TODO 助手流式 API
│   └── *.test.js              # 7 个测试文件
├── src/
│   ├── index.js               # 入口，字体，CSS 变量
│   ├── App.jsx                # 根组件，快捷键，IPC 订阅
│   ├── store/
│   │   ├── sessions.js        # Zustand store（唯一状态源）
│   │   ├── sessionState.js    # 纯函数（可独立测试）
│   │   └── sessionState.test.js
│   ├── constants/
│   │   └── toolVisuals.js     # 工具视觉元数据单一真源
│   ├── utils/
│   │   ├── sound.js           # Web Audio 提示音
│   │   ├── format.js          # 时长格式化
│   │   └── drag.js            # 拖放检测（外部/内部）
│   └── components/
│       ├── Sidebar.jsx            # 项目树 + 会话列表 + 统计
│       ├── sidebar/               # 侧边栏子组件
│       │   ├── ProjectSection.jsx # 项目卡片
│       │   ├── SessionRow.jsx     # 会话行
│       │   ├── EditableLabel.jsx  # 内联编辑
│       │   ├── helpers.js         # 阶段指示器
│       │   ├── icons.js           # SVG 图标
│       │   └── styles.js          # 共享样式
│       ├── TerminalView.jsx   # xterm 终端 + 工具栏 + 监控条
│       ├── ToolSelector.jsx   # 工具/Provider 下拉选择器
│       ├── ResourceBar.jsx    # 系统资源监控条
│       ├── SplitContainer.jsx # 分屏容器
│       ├── GitPanel.jsx       # Git 管理
│       ├── FileTreePanel.jsx  # 文件浏览器
│       ├── FilePreviewPanel.jsx # 文件预览
│       ├── SettingsModal.jsx  # 5-tab 设置窗口
│       │   └── settings/          # 设置子组件
│       │       ├── ProviderCard.jsx
│       │       ├── CustomProviderCard.jsx
│       │       ├── AgentConfigTab.jsx
│       │       ├── AppearanceTab.jsx
│       │       ├── ToolRow.jsx
│       │       ├── TabButton.jsx
│       │       ├── Field.jsx
│       │       └── styles.js
│       ├── CommandPalette.jsx # Cmd+P 快速启动
│       ├── TodoPanel.jsx      # TODO 管理
│       ├── TodoAIChat.jsx     # AI TODO 助手聊天
│       ├── ToastStack.jsx     # 通知 toast
│       ├── ToolIcons.jsx      # 手绘 SVG 图标集
│       ├── PromptDialog.jsx   # Promise-based prompt
│       ├── ContextMenu.jsx    # 通用右键菜单
│       └── ErrorBoundary.jsx  # 渲染错误边界
├── .github/workflows/ci.yml
├── BUILD.md
├── README.md
├── package.json
└── build-assets/
    └── icon.svg
```

---

*Updated: 2026-04-18 — 全量项目分析：新增 terminalBuffer/resourceMonitor/fs-handlers 拆分/sidebar+settings 子组件/ToolSelector/ResourceBar/drag+format utils*
