# TerminalView.jsx 组件拆分方案

> 作者: dev-lead | 日期: 2026-04-17 | 版本: v1.0
> 目标: 将 TerminalView.jsx (1414 行) 拆分为 5 个子组件 + 3 个自定义 hook，每步可独立验证

---

## 1. 现状分析

### 1.1 当前职责分布（按行号）

| 职责 | 行范围 | 行数 | 说明 |
|------|--------|------|------|
| buildLaunchCommand 纯函数 | L47-L82 | 35 | 工具/Provider 命令构建 |
| formatDuration 纯函数 | L86-L95 | 10 | 时长格式化 |
| ToolButton 子组件 + 样式 | L99-L175 | 77 | 已是独立函数组件 |
| PhaseBadge 子组件 + 样式 | L179-L284 | 106 | 已是独立函数组件 |
| XTERM_THEME 常量 | L288-L311 | 24 | 终端配色 |
| Store 订阅 + ref 同步 | L395-L416 | 22 | 12 个 store selector + 3 个 ref 同步 |
| initTerminal (xterm 生命周期) | L420-L593 | 174 | 核心逻辑，addon 时序敏感 |
| ResizeObserver | L597-L618 | 22 | 终端尺寸自适应 |
| Lifecycle cleanup | L622-L654 | 33 | unmount 时 dispose xterm + 取消订阅 |
| handleLaunchTool/handleLaunchProvider | L665-L714 | 50 | 启动逻辑 |
| 文件拖放 handleDrop/handleDragOver | L742-L801 | 60 | Finder + 内部文件拖入终端 |
| 工具栏 JSX | L817-L1040 | 224 | 左侧工具按钮 + 右侧开关按钮 |
| 状态条 JSX | L1042-L1079 | 38 | SESSION / STATUS / LAST / CWD |
| 搜索栏 JSX | L1082-L1125 | 44 | Cmd+F 触发的终端内搜索 |
| 终端容器 JSX | L1128-L1153 | 26 | xterm 挂载点 + 拖放区域 |
| 样式对象 styles | L1159-L1414 | 256 | 全部内联样式 |

### 1.2 核心问题

1. **单文件 1414 行**超出可维护阈值（建议单组件 < 300 行）
2. **xterm.js 生命周期**与 UI 渲染耦合在同一组件，改 UI 误触 xterm 逻辑
3. **store 订阅散落在组件顶层**（12 个 selector），难以追踪数据来源
4. **工具栏 JSX 224 行**是纯 UI，无理由与终端生命周期共处
5. **搜索栏**自带状态（searchOpen / searchQuery），天然适合独立

### 1.3 拆分约束（红线）

1. **initTerminal 函数必须保持完整性** -- xterm addon 加载顺序（FitAddon -> WebLinksAddon -> Unicode11Addon -> SearchAddon -> open() -> WebglAddon）有时序依赖，不可拆散
2. **所有 useRef 的 xterm 实例引用（termRef / fitAddonRef / searchAddonRef / webglAddonRef）归属同一个 hook** -- 跨组件传递 xterm 实例引用会导致时序 bug
3. **React 18 strict mode double-mount** 已有防护（initializedRef），拆分后每个子组件不可重复挂载 xterm
4. **终端搜索栏需要 searchAddonRef** -- 必须通过 props 从 hook 持有者传入，不可重新获取

---

## 2. 拆分后的目标架构

```
TerminalView.jsx (协调层, ~120 行)
  |
  +-- useTerminalLifecycle()        [hook] xterm 初始化/resize/dispose
  +-- useTerminalLaunch()            [hook] 工具/Provider 启动逻辑
  +-- useTerminalDrop()              [hook] 文件拖放处理
  |
  +-- <Toolbar />                    [组件] 工具栏（左侧工具按钮 + 右侧开关）
  +-- <MonitorBar />                 [组件] 状态条（SESSION/STATUS/LAST/CWD）
  +-- <SearchBar />                  [组件] 终端内搜索（Cmd+F）
  +-- <TerminalCanvas />             [组件] xterm 挂载容器（纯 div，接收 ref）
  |
  +-- (已存在的) ToolButton          [组件] 单个工具按钮（不改动）
  +-- (已存在的) PhaseBadge          [组件] 四态状态徽标（不改动）
```

### 2.1 文件清单

| 新文件路径 | 职责 | 预估行数 |
|------------|------|----------|
| `src/hooks/useTerminalLifecycle.js` | xterm 初始化 / addon 加载 / resize / dispose / auto-restore | ~230 |
| `src/hooks/useTerminalLaunch.js` | buildLaunchCommand + handleLaunchTool + handleLaunchProvider | ~120 |
| `src/hooks/useTerminalDrop.js` | 文件拖放处理（Finder + 内部拖拽 + 图片转换） | ~90 |
| `src/components/terminal/Toolbar.jsx` | 工具栏 UI（左侧工具/Provider 按钮 + 右侧开关组） | ~250 |
| `src/components/terminal/MonitorBar.jsx` | 状态条 UI（SESSION / STATUS / LAST / CWD） | ~80 |
| `src/components/terminal/SearchBar.jsx` | 终端内搜索 UI + 键盘交互 | ~80 |
| `src/components/terminal/TerminalCanvas.jsx` | xterm 挂载点 div + 拖放视觉反馈 | ~50 |
| `src/components/terminal/xtermTheme.js` | XTERM_THEME 常量 + formatDuration 纯函数 | ~40 |
| `src/components/TerminalView.jsx` | 协调层：组合 hooks + 渲染子组件 | ~120 |

**不动的文件**: `ToolButton`、`PhaseBadge`（已提取为独立函数组件，留在 TerminalView.jsx 内作为局部组件，后续如需复用再提取）。也可以在这一轮直接提取到独立文件。见下方 2.2 节。

### 2.2 ToolButton / PhaseBadge 的处理

这两个已经是函数组件，但在 TerminalView.jsx 内部定义。

**决策**: 本轮一并提取到独立文件。理由：
- ToolButton 已有完整 props 接口，无依赖外部闭包
- PhaseBadge 同理
- 提取后 Toolbar.jsx 可以直接 import，不需要通过 props 传递

| 新文件路径 | 内容 |
|------------|------|
| `src/components/terminal/ToolButton.jsx` | ToolButton 组件 + toolBtnStyles |
| `src/components/terminal/PhaseBadge.jsx` | PhaseBadge 组件 + badgeStyles |

---

## 3. Hook 接口设计

### 3.1 useTerminalLifecycle

**职责**: xterm.js 终端的完整生命周期管理 -- 初始化、resize、dispose、auto-restore。

```javascript
// src/hooks/useTerminalLifecycle.js

/**
 * @param {Object} params
 * @param {string} params.sessionId - 会话 ID
 * @param {string} params.cwd - 工作目录
 * @param {boolean} params.isActive - 是否为当前激活会话
 * @param {string|null} params.sessionLastTool - 上次使用的工具 ID（用于 auto-restore）
 * @param {boolean} params.autoRestoreSessions - 是否自动恢复会话
 * @param {Function} params.setSearchOpen - Cmd+F 搜索栏开关（xterm keydown handler 内调用）
 *
 * @returns {Object}
 *   containerRef:   React.RefObject  - xterm 挂载点的 div ref
 *   termRef:        React.RefObject  - Terminal 实例 ref（外部用于 focus）
 *   searchAddonRef: React.RefObject  - SearchAddon ref（外部用于搜索操作）
 *   fitAddonRef:    React.RefObject  - FitAddon ref（外部用于手动 fit）
 */
export function useTerminalLifecycle({
  sessionId,
  cwd,
  isActive,
  sessionLastTool,
  autoRestoreSessions,
  setSearchOpen,
}) {
  // 返回 refs，不返回任何 state
  // 内部管理: initializedRef, unsubDataRef, unsubExitRef, restoreTimerRef,
  //           ptyReadyRef, pendingInputRef, webglAddonRef, toolCatalogRef
}
```

**关键实现要点**:

1. **initTerminal 函数体原封不动搬入**，包括整个 addon 加载序列
2. **ResizeObserver useEffect 搬入**，不变
3. **Lifecycle cleanup useEffect 搬入**，不变
4. **三个 focus useEffect 搬入**（searchOpen 关闭后 focus、window focus 恢复、isActive 切换 focus）
5. **toolCatalogRef / sessionLastToolRef / autoRestoreSessionsRef 的同步 useEffect 搬入**
6. `buildLaunchCommand` 的调用（auto-restore 分支）通过内部 import 解决，不需要外部传入

**依赖**: 内部 import `buildLaunchCommand`（从 useTerminalLaunch.js 或独立 utils 文件）和 `XTERM_THEME` / `TOOL_VISUALS`。

### 3.2 useTerminalLaunch

**职责**: 构建 AI 工具/Provider 的启动命令，执行启动前校验。

```javascript
// src/hooks/useTerminalLaunch.js

/**
 * 纯函数 -- 构建启动命令字符串
 * （从 TerminalView.jsx 第 47-82 行搬出）
 */
export function buildLaunchCommand({ kind, tool, provider, yoloMode, continueMode, toolCatalog }) {
  // ... 不变
}

/**
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {React.RefObject} params.termRef - Terminal 实例 ref（用于启动后 focus）
 * @param {Object} params.toolCatalog - 工具目录
 * @param {Object} params.toolStatus - 工具安装状态
 * @param {Function} params.getEffectiveProvider - 获取有效 Provider 配置
 * @param {Function} params.openSettings - 打开设置面板
 * @param {boolean} params.yoloMode - YOLO 模式开关
 *
 * @returns {Object}
 *   handleLaunchTool:      (toolId, { continueMode? }) => void
 *   handleLaunchProvider:  (providerId, { continueMode? }) => void
 */
export function useTerminalLaunch({
  sessionId,
  termRef,
  toolCatalog,
  toolStatus,
  getEffectiveProvider,
  openSettings,
  yoloMode,
}) {
  const handleLaunchTool = (toolId, { continueMode = false } = {}) => {
    // ... 搬自 TerminalView.jsx L665-L684
  };

  const handleLaunchProvider = (providerId, { continueMode = false } = {}) => {
    // ... 搬自 TerminalView.jsx L686-L714
  };

  return { handleLaunchTool, handleLaunchProvider };
}
```

**关键实现要点**:

1. `buildLaunchCommand` 作为纯函数一起 export（auto-restore 逻辑也需要它）
2. 不访问 store，所有数据通过参数传入
3. `termRef` 通过参数传入（从 useTerminalLifecycle 返回的），启动后 focus 终端

### 3.3 useTerminalDrop

**职责**: 处理文件拖放到终端的逻辑（Finder 外部文件 + 内部 FileTreePanel 拖拽 + 图片格式转换）。

```javascript
// src/hooks/useTerminalDrop.js

/**
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {React.RefObject} params.termRef - Terminal 实例 ref（拖放后 focus）
 *
 * @returns {Object}
 *   handleDrop:      (e: DragEvent) => void
 *   handleDragOver:  (e: DragEvent) => void
 */
export function useTerminalDrop({ sessionId, termRef }) {
  const handleDrop = async (e) => {
    // ... 搬自 TerminalView.jsx L742-L795
    // 内部调用 window.electronAPI.normalizeImage / insertTextInPty
    // 内部调用 useSessionStore.getState().addToast（仅在转换成功时）
  };

  const handleDragOver = (e) => {
    // ... 搬自 TerminalView.jsx L797-L801
  };

  return { handleDrop, handleDragOver };
}
```

**关键实现要点**:

1. `addToast` 通过 `useSessionStore.getState().addToast` 获取（因为拖放是一个低频操作，不需要订阅 store）
2. `termRef` 从外部传入

---

## 4. 子组件接口设计

### 4.1 Toolbar

```jsx
// src/components/terminal/Toolbar.jsx

/**
 * @param {Object} props
 * @param {Function} props.onLaunchTool      - (toolId, { continueMode }) => void
 * @param {Function} props.onLaunchProvider  - (providerId, { continueMode }) => void
 * @param {Object}   props.toolCatalog       - { tools, providers }
 * @param {Object}   props.toolStatus        - { toolId: { installed, version } }
 * @param {Object}   props.providerConfigs   - { providerId: { apiKey, ... } }
 * @param {boolean}  props.yoloMode
 * @param {Function} props.onYoloToggle
 * @param {boolean}  props.notificationsEnabled
 * @param {Function} props.onNotificationsToggle
 * @param {boolean}  props.alwaysOnTop
 * @param {Function} props.toggleAlwaysOnTop
 * @param {boolean}  props.fileTreeOpen
 * @param {Function} props.toggleFileTree
 * @param {boolean}  props.gitPanelOpen
 * @param {Function} props.toggleGitPanel
 * @param {boolean}  props.todoPanelOpen
 * @param {Function} props.toggleTodoPanel
 * @param {number}   props.todoActiveCount
 * @param {boolean}  props.broadcastMode
 * @param {Function} props.toggleBroadcastMode
 * @param {Function} props.openSettings
 * @param {string}   props.sessionId         - PromptTemplate 需要
 */
export default function Toolbar(props) { ... }
```

**内部状态**: `hoveredTool`（useState）-- 工具按钮悬停高亮，`promptTemplateOpen`（useState）-- 模板面板开关。

**子组件引用**: ToolButton、PromptTemplate。

**store 访问**: 无。全部通过 props 传入。

### 4.2 MonitorBar

```jsx
// src/components/terminal/MonitorBar.jsx

/**
 * @param {Object} props
 * @param {string}  props.sessionElapsed  - 格式化的会话时长（如 "5m 30s"）
 * @param {string}  props.phase           - 当前进程阶段
 * @param {Object}  props.runningInfo     - 当前运行工具的视觉信息 { label, color, glow }
 * @param {string}  props.runningDuration - 当前运行工具的运行时长
 * @param {Object}  props.lastRanInfo     - 上次运行工具的视觉信息
 * @param {string}  props.lastRanDuration - 上次运行工具的持续时长
 * @param {string}  props.cwd             - 完整工作目录路径
 * @param {string}  props.displayCwd      - 简化显示路径（~ 替换 homeDir）
 */
export default function MonitorBar(props) { ... }
```

**内部状态**: 无。纯展示组件。

**子组件引用**: PhaseBadge。

**store 访问**: 无。

### 4.3 SearchBar

```jsx
// src/components/terminal/SearchBar.jsx

/**
 * @param {Object} props
 * @param {boolean}        props.open          - 是否显示
 * @param {Function}       props.onClose       - () => void（关闭搜索栏）
 * @param {React.RefObject} props.searchAddonRef - xterm SearchAddon 实例 ref
 */
export default function SearchBar({ open, onClose, searchAddonRef }) {
  // 内部管理: searchQuery (useState)
  // 内部管理: input ref (useRef) -- 用于 autoFocus
  // 键盘: Enter -> findNext, Shift+Enter -> findPrevious, Escape -> onClose
}
```

**内部状态**: `searchQuery`（useState）。

**store 访问**: 无。

**关键实现要点**:

1. 当 `open` 从 true 变 false 时，调用 `searchAddonRef.current?.clearDecorations()`
2. 不在组件内部管理 `open` 状态（由 TerminalView 通过 setSearchOpen 控制）

### 4.4 TerminalCanvas

```jsx
// src/components/terminal/TerminalCanvas.jsx

/**
 * @param {Object} props
 * @param {React.RefObject} props.containerRef - xterm 挂载 div 的 ref（从 hook 传入）
 * @param {boolean}          props.splitMode   - 是否分屏模式（影响 minWidth）
 * @param {Function}         props.onDrop      - 文件拖放处理函数
 * @param {Function}         props.onDragOver  - 拖入处理函数
 * @param {Function}         props.onFocus     - 点击时 focus 终端
 */
export default function TerminalCanvas({ containerRef, splitMode, onDrop, onDragOver, onFocus }) {
  // 纯容器 div，不做任何逻辑
}
```

**内部状态**: 无。

**store 访问**: 无。

### 4.5 xtermTheme.js

```javascript
// src/components/terminal/xtermTheme.js

export const XTERM_THEME = {
  background: '#0d0d0d',
  // ... 完整配色表
};

export function formatDuration(ms) {
  // ... 搬自 TerminalView.jsx L86-L95
}
```

纯常量 + 纯函数文件，无 React 依赖。

### 4.6 ToolButton (提取)

```jsx
// src/components/terminal/ToolButton.jsx

export function ToolButton({ id, label, color, glow, isInstalled, isHovered, onHover, onClick, title }) {
  // ... 不变，搬自 TerminalView.jsx L99-L133
}

export const toolBtnStyles = { /* ... */ };
```

### 4.7 PhaseBadge (提取)

```jsx
// src/components/terminal/PhaseBadge.jsx

import { PHASE_STANDBY, PHASE_REVIEW } from '../../constants/toolVisuals';

export function PhaseBadge({ phase, toolInfo, duration }) {
  // ... 不变，搬自 TerminalView.jsx L179-L246
}

export const badgeStyles = { /* ... */ };
```

---

## 5. 拆分后的 TerminalView.jsx（协调层）

```jsx
// src/components/TerminalView.jsx -- 拆分后的协调层（约 120 行）

import React, { useState } from 'react';
import { useSessionStore } from '../store/sessions';
import { TOOL_VISUALS } from '../constants/toolVisuals';

import { useTerminalLifecycle } from '../hooks/useTerminalLifecycle';
import { useTerminalLaunch } from '../hooks/useTerminalLaunch';
import { useTerminalDrop } from '../hooks/useTerminalDrop';

import Toolbar from './terminal/Toolbar';
import MonitorBar from './terminal/MonitorBar';
import SearchBar from './terminal/SearchBar';
import TerminalCanvas from './terminal/TerminalCanvas';
import { formatDuration } from './terminal/xtermTheme';

export default function TerminalView({
  sessionId, cwd, yoloMode, onYoloToggle,
  sessionCreatedAt, sessionStatus,
  notificationsEnabled, onNotificationsToggle,
  sessionLastTool, isActive, splitMode,
}) {
  // -- Local UI state --
  const [searchOpen, setSearchOpen] = useState(false);

  // -- Store selectors (协调层统一读取，通过 props 下发) --
  const toolCatalog = useSessionStore((s) => s.toolCatalog);
  const toolStatus = useSessionStore((s) => s.toolStatus);
  const providerConfigs = useSessionStore((s) => s.providerConfigs);
  const openSettings = useSessionStore((s) => s.openSettings);
  const alwaysOnTop = useSessionStore((s) => s.alwaysOnTop);
  const toggleAlwaysOnTop = useSessionStore((s) => s.toggleAlwaysOnTop);
  const getEffectiveProvider = useSessionStore((s) => s.getEffectiveProvider);
  const fileTreeOpen = useSessionStore((s) => s.fileTreeOpen);
  const toggleFileTree = useSessionStore((s) => s.toggleFileTree);
  const gitPanelOpen = useSessionStore((s) => s.gitPanelOpen);
  const toggleGitPanel = useSessionStore((s) => s.toggleGitPanel);
  const todoPanelOpen = useSessionStore((s) => s.todoPanelOpen);
  const toggleTodoPanel = useSessionStore((s) => s.toggleTodoPanel);
  const todoActiveCount = useSessionStore((s) => s.todos.filter((t) => !t.done).length);
  const broadcastMode = useSessionStore((s) => s.broadcastMode);
  const toggleBroadcastMode = useSessionStore((s) => s.toggleBroadcastMode);
  const autoRestoreSessions = useSessionStore((s) => s.autoRestoreSessions);
  const now = useSessionStore((s) => s.now);

  // -- Hooks --
  const { containerRef, termRef, searchAddonRef } = useTerminalLifecycle({
    sessionId, cwd, isActive, sessionLastTool, autoRestoreSessions, setSearchOpen,
  });

  const { handleLaunchTool, handleLaunchProvider } = useTerminalLaunch({
    sessionId, termRef, toolCatalog, toolStatus, getEffectiveProvider, openSettings, yoloMode,
  });

  const { handleDrop, handleDragOver } = useTerminalDrop({ sessionId, termRef });

  // -- Derived values --
  const homeDir = window.electronAPI?.homeDir || '';
  const displayCwd = cwd?.startsWith(homeDir) ? cwd.replace(homeDir, '~') : cwd;
  const sessionElapsed = formatDuration(sessionCreatedAt ? now - sessionCreatedAt : 0);
  const runningTool = sessionStatus?.tool;
  const runningInfo = runningTool ? TOOL_VISUALS[runningTool] : null;
  const runningDuration = runningTool && sessionStatus?.startedAt
    ? formatDuration(now - sessionStatus.startedAt) : null;
  const lastRanTool = sessionStatus?.lastRanTool;
  const lastRanInfo = lastRanTool ? TOOL_VISUALS[lastRanTool] : null;
  const lastRanDuration = sessionStatus?.lastDuration
    ? formatDuration(sessionStatus.lastDuration) : null;

  return (
    <div ref={wrapperRef} style={styles.wrapper} onDragOver={handleDragOver} onDrop={handleDrop}>
      <div style={styles.dragBar} className="drag-region" />

      <Toolbar
        onLaunchTool={handleLaunchTool}
        onLaunchProvider={handleLaunchProvider}
        toolCatalog={toolCatalog}
        toolStatus={toolStatus}
        providerConfigs={providerConfigs}
        yoloMode={yoloMode}
        onYoloToggle={onYoloToggle}
        notificationsEnabled={notificationsEnabled}
        onNotificationsToggle={onNotificationsToggle}
        alwaysOnTop={alwaysOnTop}
        toggleAlwaysOnTop={toggleAlwaysOnTop}
        fileTreeOpen={fileTreeOpen}
        toggleFileTree={toggleFileTree}
        gitPanelOpen={gitPanelOpen}
        toggleGitPanel={toggleGitPanel}
        todoPanelOpen={todoPanelOpen}
        toggleTodoPanel={toggleTodoPanel}
        todoActiveCount={todoActiveCount}
        broadcastMode={broadcastMode}
        toggleBroadcastMode={toggleBroadcastMode}
        openSettings={openSettings}
        sessionId={sessionId}
      />

      <MonitorBar
        sessionElapsed={sessionElapsed}
        phase={sessionStatus?.phase}
        runningInfo={runningInfo}
        runningDuration={runningDuration}
        lastRanInfo={lastRanInfo}
        lastRanDuration={lastRanDuration}
        cwd={cwd}
        displayCwd={displayCwd || '~'}
      />

      <SearchBar
        open={searchOpen}
        onClose={() => { setSearchOpen(false); }}
        searchAddonRef={searchAddonRef}
      />

      <TerminalCanvas
        containerRef={containerRef}
        splitMode={splitMode}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onFocus={() => termRef.current?.focus()}
      />
    </div>
  );
}

// styles 对象保留在此文件（wrapper / dragBar 仅协调层使用）
const styles = {
  wrapper: { /* ... */ },
  dragBar: { /* ... */ },
};
```

---

## 6. 数据流图

```
                    useSessionStore (Zustand)
                         |
            +------------+------------+
            |                         |
   TerminalView (协调层)          useTerminalLifecycle
   - 12 个 store selector         - autoRestoreSessions (param)
   - 派生值计算                    - sessionLastTool (param)
   - 组合 hooks                    - sessionLastToolRef (内部 sync)
   - props 下发子组件              - toolCatalogRef (内部 sync)
            |
   +--------+--------+--------+
   |        |        |        |
Toolbar  MonitorBar SearchBar TerminalCanvas
(props)  (props)   (props)    (containerRef)
   |
   +-- ToolButton (import)
   +-- PromptTemplate (import)

useTerminalLaunch <-- termRef from useTerminalLifecycle
useTerminalDrop   <-- termRef from useTerminalLifecycle
```

---

## 7. 实施步骤（渐进式，每步可独立验证）

### Step 0: 准备工作

**动作**: 创建目录结构

```
mkdir -p src/hooks
mkdir -p src/components/terminal
```

**验证**: 目录存在，不影响现有代码。

### Step 1: 提取纯函数和常量

**动作**: 新建 `src/components/terminal/xtermTheme.js`，搬入 `XTERM_THEME` 常量和 `formatDuration` 函数。

**文件变更**:
- 新建 `src/components/terminal/xtermTheme.js`
- 修改 `src/components/TerminalView.jsx` -- 删除原定义，改为 `import { XTERM_THEME, formatDuration } from './terminal/xtermTheme';`

**验证**: `npm start` 启动无报错，终端配色和时长显示不变。

### Step 2: 提取 ToolButton 和 PhaseBadge

**动作**: 将这两个已有的独立函数组件提取到各自文件。

**文件变更**:
- 新建 `src/components/terminal/ToolButton.jsx`
- 新建 `src/components/terminal/PhaseBadge.jsx`
- 修改 `src/components/TerminalView.jsx` -- 删除原定义，改为 import

**验证**: `npm start` 启动无报错，工具按钮和状态徽标渲染不变。

### Step 3: 提取 useTerminalLifecycle hook

**动作**: 新建 `src/hooks/useTerminalLifecycle.js`，搬入以下内容：
- 所有 ref 声明（containerRef / termRef / fitAddonRef / searchAddonRef / webglAddonRef / initializedRef / unsubDataRef / unsubExitRef / restoreTimerRef / ptyReadyRef / pendingInputRef / toolCatalogRef / sessionLastToolRef / autoRestoreSessionsRef）
- initTerminal 函数（完整搬入，不改逻辑）
- ResizeObserver useEffect
- Lifecycle cleanup useEffect
- 三个 focus useEffect（searchOpen / window focus / isActive）
- ref 同步 useEffect（toolCatalogRef / sessionLastToolRef / autoRestoreSessionsRef）

**文件变更**:
- 新建 `src/hooks/useTerminalLifecycle.js`
- 修改 `src/components/TerminalView.jsx` -- 删除上述内容，改为 `import { useTerminalLifecycle } from '../hooks/useTerminalLifecycle';`

**验证**:
1. `npm start` 启动无报错
2. 终端正常初始化，能输入命令
3. 切换会话时终端 focus 正常
4. 窗口隐藏再显示后键盘输入正常
5. 调整窗口大小时终端自适应

**风险**: 这一步最关键。xterm addon 加载时序如果出错，终端会白屏。回滚方案：还原 TerminalView.jsx。

### Step 4: 提取 useTerminalLaunch hook

**动作**: 新建 `src/hooks/useTerminalLaunch.js`，搬入 `buildLaunchCommand` 纯函数 + `handleLaunchTool` + `handleLaunchProvider`。

**文件变更**:
- 新建 `src/hooks/useTerminalLaunch.js`
- 修改 `src/components/TerminalView.jsx` -- 删除启动逻辑，改为 hook 调用

**验证**:
1. `npm start` 启动无报错
2. 点击工具栏按钮能正常启动 Claude / Codex 等
3. YOLO 模式切换后启动命令包含正确 flag
4. 未安装工具时弹出确认框
5. Provider 未配置 API Key 时弹出提示并打开设置

### Step 5: 提取 useTerminalDrop hook

**动作**: 新建 `src/hooks/useTerminalDrop.js`，搬入 `handleDrop` 和 `handleDragOver`。

**文件变更**:
- 新建 `src/hooks/useTerminalDrop.js`
- 修改 `src/components/TerminalView.jsx` -- 删除拖放逻辑，改为 hook 调用

**验证**:
1. `npm start` 启动无报错
2. 从 Finder 拖文件到终端，路径正确插入
3. 从左侧文件树拖文件到终端，路径正确插入
4. HEIC/TIFF 图片自动转换 PNG 并显示 toast

### Step 6: 提取 SearchBar 组件

**动作**: 新建 `src/components/terminal/SearchBar.jsx`。

**文件变更**:
- 新建 `src/components/terminal/SearchBar.jsx`
- 修改 `src/components/TerminalView.jsx` -- 删除搜索栏 JSX 和 searchQuery state

**验证**:
1. `npm start` 启动无报错
2. Cmd+F 打开搜索栏
3. 输入文本后高亮匹配
4. Enter / Shift+Enter 上下导航
5. Escape 关闭搜索栏并恢复终端 focus

### Step 7: 提取 MonitorBar 组件

**动作**: 新建 `src/components/terminal/MonitorBar.jsx`。

**文件变更**:
- 新建 `src/components/terminal/MonitorBar.jsx`
- 修改 `src/components/TerminalView.jsx` -- 删除状态条 JSX 和相关 styles

**验证**:
1. `npm start` 启动无报错
2. SESSION 时长显示正确
3. STATUS 四态切换正常（未启动 / 未指令 / 运行中 / 待审查）
4. LAST 区域显示上次工具和时长
5. CWD 路径显示正确

### Step 8: 提取 Toolbar 组件

**动作**: 新建 `src/components/terminal/Toolbar.jsx`。这一步工作量最大（224 行 JSX + 状态）。

**文件变更**:
- 新建 `src/components/terminal/Toolbar.jsx`
- 修改 `src/components/TerminalView.jsx` -- 删除工具栏 JSX 和 hoveredTool state

**验证**:
1. `npm start` 启动无报错
2. 所有工具按钮渲染正确（颜色、图标、标签）
3. 悬停高亮效果正常
4. YOLO / 通知 / 置顶 / TODO / 广播 / Git / 文件树 / 模板 / 设置按钮全部正常
5. TODO 未完成计数徽标显示正确
6. Prompt 模板面板打开/关闭正常

### Step 9: 提取 TerminalCanvas 组件

**动作**: 新建 `src/components/terminal/TerminalCanvas.jsx`。

**文件变更**:
- 新建 `src/components/terminal/TerminalCanvas.jsx`
- 修改 `src/components/TerminalView.jsx` -- 删除终端容器 JSX

**验证**:
1. `npm start` 启动无报错
2. 终端渲染正常
3. 分屏模式下 minWidth 为 350px

### Step 10: 清理样式

**动作**: 将各组件专属样式对象搬到对应组件文件中，TerminalView.jsx 只保留 wrapper / dragBar 样式。

**文件变更**: 修改所有新文件，搬入对应的 styles 对象。

**验证**: 全量回归测试（视觉无变化）。

---

## 8. 风险点与缓解措施

| 风险 | 影响 | 缓解 |
|------|------|------|
| xterm addon 加载时序被破坏 | 终端白屏 | Step 3 单独验证，initTerminal 整体搬迁不拆散 |
| searchAddonRef 跨组件传递失败 | 搜索不工作 | 通过 useTerminalLifecycle 返回 ref，单向传递 |
| React 18 double-mount 导致重复初始化 | 两个 pty 进程 | initializedRef 逻辑保留在 hook 内部 |
| WebGL addon dispose 时序 | 控制台报错 | dispose 顺序不变（WebGL 先于 Terminal） |
| ToolButton hover 状态与父组件不同步 | UI 闪烁 | hoveredTool 留在 Toolbar 内部管理 |

---

## 9. In-scope / Out-of-scope

### In-scope（本次必做）

1. 提取 3 个自定义 hook（useTerminalLifecycle / useTerminalLaunch / useTerminalDrop）
2. 提取 4 个 UI 子组件（Toolbar / MonitorBar / SearchBar / TerminalCanvas）
3. 提取 2 个已独立组件（ToolButton / PhaseBadge）
4. 提取 1 个常量文件（xtermTheme.js）
5. 重构 TerminalView.jsx 为协调层（~120 行）

### Out-of-scope（本次明确不做）

1. **样式系统改造**（CSS-in-JS -> CSS Modules / styled-components） -- 超出本次范围，当前 inline style 虽不理想但可工作
2. **Store 订阅优化**（减少 selector 数量） -- 可在后续 Task 用 Zustand selector 合并优化
3. **TerminalView props 接口重设计**（当前接口已稳定，App.jsx 调用方无需改动）
4. **xterm.js 升级**（等上游修复 #4793 ImageAddon bug）
5. **性能优化**（React.memo / useMemo 等） -- 拆分后再做性能 profiling

### 边界依据

- 本次目标仅限 **结构重组**，不改变任何运行时行为
- 样式系统和性能优化属于独立关注点，混入会扩大验证范围
- props 接口变更需要修改 App.jsx，增加回归风险

### 违反边界的后果

- 开发若在拆分过程中顺手"优化"其他逻辑，必须通过 BLOCKED 回归方案复核
- 任何导致 App.jsx 调用方接口变更的改动，需要单独评审

---

## 10. Definition of Done

1. `TerminalView.jsx` 行数 < 150 行（当前 1414 行）
2. `npm start` 启动后所有终端功能正常（初始化、输入、resize、搜索、拖放、工具启动、状态显示）
3. 每个新文件有明确单一职责，无循环依赖
4. 所有新组件通过 props 接收数据，不直接访问 store（hook 除外，hook 通过参数接收 store 值）
5. 分屏模式下终端行为不变
6. Auto-restore 功能正常（上次会话工具自动续接）

---

## 11. 最终文件结构

```
src/
  hooks/
    useTerminalLifecycle.js    # xterm 生命周期（~230 行）
    useTerminalLaunch.js       # 工具/Provider 启动（~120 行）
    useTerminalDrop.js         # 文件拖放（~90 行）
  components/
    TerminalView.jsx            # 协调层（~120 行）
    terminal/
      Toolbar.jsx              # 工具栏（~250 行）
      MonitorBar.jsx           # 状态条（~80 行）
      SearchBar.jsx            # 搜索栏（~80 行）
      TerminalCanvas.jsx       # 终端容器（~50 行）
      ToolButton.jsx           # 工具按钮（~80 行）
      PhaseBadge.jsx           # 状态徽标（~110 行）
      xtermTheme.js            # 终端主题常量（~40 行）
```
