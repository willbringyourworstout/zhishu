# src/ — Renderer Process

Electron 渲染进程。React 18 UI + Zustand 全局状态 + xterm.js 终端。

**技术栈**: React 18 / Zustand / xterm.js (WebGL) / CSS-in-JS
**入口**: `index.js` → `App.jsx`

## 架构

```
App.jsx (根组件：快捷键 + IPC 订阅 + 布局)
  ├── Sidebar.jsx
  │     └── sidebar/ProjectSection.jsx → sidebar/SessionRow.jsx
  ├── TerminalView.jsx (xterm.js + 工具栏 + 监控条)
  │     ├── ToolSelector.jsx (下拉选择器)
  │     └── ResourceBar.jsx (CPU/MEM/BAT)
  ├── SplitContainer.jsx (分屏容器)
  ├── FileTreePanel.jsx (文件浏览器)
  ├── FilePreviewPanel.jsx (文件预览)
  ├── GitPanel.jsx (Git 管理)
  ├── TodoPanel.jsx → TodoAIChat.jsx (TODO + AI 助手)
  ├── ToastStack.jsx (通知)
  ├── SettingsModal.jsx → settings/* (设置)
  ├── CommandPalette.jsx (Cmd+P)
  ├── PromptDialog.jsx (Promise-based prompt)
  └── ContextMenu.jsx (通用右键菜单)
```

## Zustand Store (`store/sessions.js`)

唯一状态源。纯函数抽取到 `store/sessionState.js`。

**核心状态**: projects, sessions, activeSessionId, sessionStatus, toolCatalog, toolStatus, providerConfigs, customProviders, groups, splitPane, todos, systemResources, theme, panels

**关键 action**:
- 项目/会话 CRUD: `addProject`, `addSession`, `removeSession`, `renameSession`, `reorderProjects`, `reorderSessions`
- Provider: `updateProviderConfig`, `addCustomProvider`, `updateCustomProvider`, `removeCustomProvider`, `getEffectiveProvider`
- 分组: `createGroup`, `removeGroup`, `renameGroup`, `moveProjectToGroup`
- 面板: `toggleFileTree`, `toggleGitPanel`, `toggleTodoPanel`, `setPanelWidth`, `commitPanelWidth`
- 通知: `addToast`（支持 mergeKey 批量合并）
- 弹窗: `showPrompt`（Promise-based, 替代 window.prompt）

## 组件通信模式

1. **Zustand Store** — 主要模式，几乎所有状态通过 store 流转
2. **Callback Props** — 父→子事件传递（App→TerminalView, Sidebar→ProjectSection）
3. **IPC** — 渲染进程 ↔ 主进程（`window.electronAPI.*`）
4. **Portal** — ContextMenu, ToolSelector, CommandPalette 渲染到 `document.body` 防裁剪
5. **HTML5 Drag** — 内部 MIME（`application/x-prism-*`）+ 外部拖放（`utils/drag.js` 检测）

## 进程边界

- `contextIsolation: true` + `nodeIntegration: false`
- 所有 Node.js 操作通过 `window.electronAPI` (preload.js) IPC 调用
- Portal 渲染: ContextMenu, ToolSelector, CommandPalette

## 关键约定

- **CSS 变量**: 深色/浅色主题通过 `:root` / `[data-theme="dark"]` CSS 变量切换
- **面板缩放**: `usePanelResizer` hook 处理 FileTree/Git/Todo/Preview 面板宽度
- **拖拽排序**: 项目和会话支持六点抓手 + 琥珀色 drop indicator
- **终端恢复**: 启动时读取 `lastTool` → 延迟 1.2s 注入 `--continue` 命令
- **资源监控**: 主进程 1.5s push `systemResources` → ResourceBar 消费

## 文件索引

### 入口 & Store

| 文件 | 行数 | 职责 |
|------|------|------|
| `index.js` | 240 | 字体导入、CSS 变量、全局样式、ReactDOM 挂载 |
| `App.jsx` | 493 | 根组件：快捷键、IPC 订阅、布局编排 |
| `store/sessions.js` | 1044 | Zustand store（唯一状态源） |
| `store/sessionState.js` | 117 | 纯函数抽取（可独立测试） |

### 核心组件

| 文件 | 行数 | 职责 |
|------|------|------|
| `components/TerminalView.jsx` | 1305 | xterm 终端 + 工具栏 + 监控条 + 搜索 + 拖放 |
| `components/GitPanel.jsx` | 1162 | Git 面板：status/diff/branch/stage/commit + 多仓库扫描 |
| `components/TodoPanel.jsx` | 912 | TODO 管理：优先级/截止日期/过滤/拖拽 |
| `components/FileTreePanel.jsx` | 814 | 文件浏览器：懒加载树 + git 着色 + 拖拽到终端 |
| `components/FilePreviewPanel.jsx` | 745 | 文件预览：图片/MD/文本/二进制 |
| `components/TodoAIChat.jsx` | 637 | AI TODO 助手：多轮对话 + tool_use |
| `components/ToolSelector.jsx` | 453 | 工具/Provider 下拉选择器 |
| `components/Sidebar.jsx` | 366 | 项目树 + 会话列表 + 统计 + 分组 |
| `components/CommandPalette.jsx` | 360 | Cmd+P 快速启动 |
| `components/ToolIcons.jsx` | 266 | 手绘 SVG 品牌/UI 图标集 |
| `components/ResourceBar.jsx` | 169 | 系统资源监控条 |
| `components/SettingsModal.jsx` | 221 | 5-tab 设置窗口 |
| `components/ToastStack.jsx` | 219 | 完成通知 toast |
| `components/PromptDialog.jsx` | 141 | Promise-based prompt 对话框 |
| `components/ContextMenu.jsx` | 141 | 通用右键菜单 (Portal) |
| `components/SplitContainer.jsx` | 134 | 分屏容器（ratio 0.2-0.8） |
| `components/ErrorBoundary.jsx` | 114 | 渲染错误边界 |

### Sidebar 子组件 (`components/sidebar/`)

| 文件 | 行数 | 职责 |
|------|------|------|
| `sidebar/ProjectSection.jsx` | 246 | 项目卡片：折叠/拖拽/重命名/TODO 徽章 |
| `sidebar/SessionRow.jsx` | 249 | 会话行：拖拽/阶段指示/内联重命名 |
| `sidebar/styles.js` | 491 | 共享 CSS-in-JS 样式 |
| `sidebar/icons.js` | 88 | 内联 SVG 图标 |
| `sidebar/helpers.js` | 49 | `getPhaseIndicator()` + `fmtDuration` |
| `sidebar/EditableLabel.jsx` | 44 | 双击内联编辑标签 |

### Settings 子组件 (`components/settings/`)

| 文件 | 行数 | 职责 |
|------|------|------|
| `settings/styles.js` | 470 | 共享 CSS-in-JS 样式 |
| `settings/CustomProviderCard.jsx` | 172 | 自定义 Anthropic 端点配置 |
| `settings/AgentConfigTab.jsx` | 115 | Agent 记忆文件管理 |
| `settings/AppearanceTab.jsx` | 95 | 主题 + 自动恢复设置 |
| `settings/ProviderCard.jsx` | 96 | 内置 Provider 配置 |
| `settings/ToolRow.jsx` | 52 | 工具安装状态行 |
| `settings/TabButton.jsx` | 21 | Tab 按钮 |
| `settings/Field.jsx` | 14 | 通用表单字段包装 |

### Constants & Utils

| 文件 | 行数 | 职责 |
|------|------|------|
| `constants/toolVisuals.js` | 95 | 工具视觉元数据单一真源 |
| `utils/format.js` | 25 | `formatDuration()` 时长格式化 |
| `utils/drag.js` | 26 | 外部/内部拖放检测 |
| `utils/sound.js` | 58 | Web Audio 提示音 |
