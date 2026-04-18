# src/components/ — React UI 组件

所有 React 组件，按功能分组。子目录 `sidebar/` 和 `settings/` 有独立 CLAUDE.md。

**技术栈**: React 18 (Hooks, memo, Portal) / CSS-in-JS / xterm.js

## 组件层次

```
App.jsx
  ├── Sidebar → sidebar/ProjectSection → sidebar/SessionRow
  ├── TerminalView → ToolSelector + ResourceBar
  ├── SplitContainer → TerminalView ×2
  ├── FileTreePanel / FilePreviewPanel / GitPanel / TodoPanel → TodoAIChat
  ├── SettingsModal → settings/*
  ├── CommandPalette / ContextMenu / ToastStack / PromptDialog
  └── ErrorBoundary
```

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `TerminalView.jsx` | 1305 | xterm 终端 + 工具栏 + PhaseBadge + 监控条 + 搜索 + 拖放 |
| `GitPanel.jsx` | 1162 | Git 管理：当前仓库 + 多仓库扫描模式 |
| `TodoPanel.jsx` | 912 | TODO 管理：优先级/截止/过滤/批量/拖拽到终端 |
| `FileTreePanel.jsx` | 814 | 文件浏览器：懒加载树 + git 着色 + 右键 + 拖拽 |
| `FilePreviewPanel.jsx` | 745 | 文件预览：图片/react-markdown/文本/二进制 |
| `TodoAIChat.jsx` | 637 | AI TODO 助手：多轮 tool_use 对话 |
| `ToolSelector.jsx` | 453 | 工具/Provider 下拉选择器（Portal） |
| `Sidebar.jsx` | 366 | 项目树 + 会话列表 + 统计 + 分组系统 |
| `CommandPalette.jsx` | 360 | Cmd+P 快速启动（模糊搜索 + 键盘导航） |
| `ToolIcons.jsx` | 266 | 手绘 SVG 图标集（`ToolIcon` 统一查找 + `AppLogo`） |
| `ResourceBar.jsx` | 169 | 系统资源条（CPU/MEM/BAT，消费 store systemResources） |
| `SettingsModal.jsx` | 221 | 5-tab 设置窗口 |
| `ToastStack.jsx` | 219 | 通知 toast（completion + info 变体，自动消失） |
| `PromptDialog.jsx` | 141 | Promise-based prompt（替代 Electron blocked window.prompt） |
| `ContextMenu.jsx` | 141 | 通用右键菜单（Portal，边缘翻转） |
| `SplitContainer.jsx` | 134 | 分屏容器（水平/垂直，ratio 0.2-0.8） |
| `ErrorBoundary.jsx` | 114 | React 错误边界（重试/重载） |

## 关键约定

- **Portal 渲染**: ContextMenu, ToolSelector, CommandPalette 通过 `createPortal` 渲染到 `document.body`
- **面板缩放**: FileTree/Git/Todo/Preview 使用 `usePanelResizer` hook 管理宽度
- **拖拽**: 内部用 `application/x-prism-*` MIME 类型，外部用 `utils/drag.js` 检测
- **性能**: ProjectSection 和 SessionRow 用 `React.memo` 包裹

## 子目录

| 目录 | 职责 | 独立文档 |
|------|------|---------|
| `sidebar/` | 侧边栏子组件（ProjectSection, SessionRow, EditableLabel） | [sidebar/CLAUDE.md](sidebar/CLAUDE.md) |
| `settings/` | 设置子组件（ProviderCard, AgentConfigTab, AppearanceTab 等） | [settings/CLAUDE.md](settings/CLAUDE.md) |
