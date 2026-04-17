# Zustand Store 拆分方案

> sessions.js (912 行) 拆分为 6 个 slice，保持单 store + 统一 persist。

**文档版本**: v1.0
**日期**: 2026-04-17
**状态**: 待实施

---

## 1. 现状诊断

### 1.1 问题清单

| ID | 问题 | 严重度 |
|----|------|--------|
| P1 | 912 行单文件，IDE 导航/跳转效率低 | 中 |
| P2 | 任意字段变更导致整个 store 的订阅者重渲染（组件未用 selector 精确订阅的 case） | 中 |
| P3 | init() 约 70 行，混合了 6 个域的初始化逻辑 | 中 |
| P4 | persist() 列了 17 个字段，新增持久化字段必须改这处 | 低 |
| P5 | 新功能（如 TODO、Broadcast、CommandPalette）直接往 store 追加，无边界 | 中 |

### 1.2 当前字段-方法归属分析

对 sessions.js 全部 912 行按职责域分组：

| 域 | 状态字段 | 方法 | 行数(估) |
|----|----------|------|----------|
| **项目/会话核心** | projects, activeSessionId, isLoading, now | init(部分), persist(部分), addProject, removeProject, renameProject, updateProjectPath, createProjectFromTemplate, addSession, removeSession, renameSession, setActiveSession, setSessionByIndex, addSessionToActiveProject, closeActiveSession, getActiveProject, getActiveSession, syncSessionNamesToMain, updateSessionStatus | ~350 |
| **分屏** | splitPane | openSplit, closeSplit, setSplitRatio, swapSplitSessions | ~50 |
| **面板/UI** | fileTreeOpen, gitPanelOpen, previewPanelOpen, filePreview, theme, sidebarWidth, gitPanelWidth, fileTreeWidth, previewPanelWidth, todoPanelWidth | toggleFileTree, closeFileTree, toggleGitPanel, closeGitPanel, openFilePreview, closeFilePreview, togglePreviewPanel, setTheme, setSidebarWidth, commitSidebarWidth, setPanelWidth, commitPanelWidth | ~80 |
| **设置/Provider/工具** | yoloMode, notificationsEnabled, alwaysOnTop, autoRestoreSessions, settingsOpen, toolCatalog, toolStatus, providerConfigs | toggleYoloMode, toggleNotifications, toggleAlwaysOnTop, toggleAutoRestoreSessions, openSettings, closeSettings, refreshToolStatus, updateProviderConfig, getEffectiveProvider | ~100 |
| **TODO** | todos, todoPanelOpen, todoLastReminderDate, todoChatProvider | toggleTodoPanel, closeTodoPanel, addTodo, updateTodo, deleteTodo, toggleTodoDone, clearDoneTodos, markTodoReminderShown, setTodoChatProvider | ~60 |
| **杂项 (Toast/Prompt/Group/Template/Broadcast/CommandPalette)** | toasts, promptDialog, promptTemplates, groups, broadcastMode, commandPaletteOpen | addToast, removeToast, showPrompt, addPromptTemplate, removePromptTemplate, updatePromptTemplate, createGroup, removeGroup, renameGroup, moveProjectToGroup, toggleGroupCollapsed, toggleBroadcastMode, disableBroadcastMode, toggleCommandPalette, closeCommandPalette | ~100 |

---

## 2. 拆分策略选择

### 2.1 方案对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. 多独立 store** | 每个 slice 是独立的 `create()` | 彻底解耦；selector 天然隔离 | persist 需要合并；跨 store 依赖需 `useStoreA.getState()` |
| **B. 单 store + slice 函数** | 一个 `create()` 内组合 slice | persist 统一；组件 import 不变 | slice 函数需手动传递 `set/get` |
| **C. 单 store + slice 文件** | slice 定义在独立文件，组合到一个 `create()` | 文件级拆分 + persist 统一 + 组件 import 不变 | 需要约定 slice 的 `set/get` 传递方式 |

### 2.2 决策：方案 C

**理由**：

1. **persist 兼容零成本**：单 store 的 `get()` 仍然能一次性取出所有字段，`persist()` 方法不需要改。
2. **组件 import 零改动**：所有组件仍然 `import { useSessionStore } from '../store/sessions'`。
3. **文件级拆分**：每个 slice 独立文件，IDE 导航清晰。
4. **渐进式**：可以一个 slice 一个 slice 地迁，不需要一次性全拆。

这是 Zustand 官方推荐的 slice pattern：每个 slice 是一个函数 `(set, get, api) => ({ ...state, ...methods })`，通过组合函数合并到 `create()` 中。

---

## 3. Slice 定义

### 3.1 目录结构

```
src/store/
  sessions.js            # 组合入口：create() + persist() + init() 编排
  sessionState.js        # 纯函数（保持不变）
  slices/
    coreSlice.js         # 项目/会话 CRUD + 进程状态
    splitSlice.js        # 分屏状态
    uiSlice.js           # 面板开关 + 宽度 + 主题
    settingsSlice.js     # 设置 + Provider + 工具状态
    todoSlice.js         # TODO CRUD + 面板状态
    miscSlice.js         # Toast + Prompt + Group + Template + Broadcast + CommandPalette
```

### 3.2 各 Slice 详细定义

#### coreSlice.js -- 项目/会话核心

**状态**：

```
projects, activeSessionId, isLoading, now, sessionStatus
```

**方法**：

```
tickNow, updateSessionStatus, syncSessionNamesToMain,
addProject, removeProject, renameProject, updateProjectPath, createProjectFromTemplate,
addSession, removeSession, renameSession,
setActiveSession, setSessionByIndex, addSessionToActiveProject, closeActiveSession,
getActiveProject, getActiveSession
```

**依赖**：读取 `splitPane`（来自 splitSlice，通过 `get()`），因为在 `removeSession` 中需要检查被删会话是否是分屏参与者。

#### splitSlice.js -- 分屏

**状态**：

```
splitPane
```

**方法**：

```
openSplit, closeSplit, setSplitRatio, swapSplitSessions
```

**依赖**：读取 `projects`、`activeSessionId`（来自 coreSlice，通过 `get()`），因为 `openSplit` 需要校验 sessionId 存在性和不能与当前活跃会话相同。`setActiveSession` 中也需要检查 split 参与者。

**注意**：`setActiveSession` 方法在 coreSlice 中定义（因为它修改 activeSessionId），但内部会检查 splitPane 状态。

#### uiSlice.js -- 面板/主题/宽度

**状态**：

```
fileTreeOpen, gitPanelOpen, previewPanelOpen, filePreview,
theme, sidebarWidth, gitPanelWidth, fileTreeWidth, previewPanelWidth, todoPanelWidth
```

**方法**：

```
toggleFileTree, closeFileTree,
toggleGitPanel, closeGitPanel,
openFilePreview, closeFilePreview, togglePreviewPanel,
setTheme, setSidebarWidth, commitSidebarWidth,
setPanelWidth, commitPanelWidth
```

**依赖**：无外部 slice 依赖。`setTheme` 调用 `persist()`（通过 `get()`）。

#### settingsSlice.js -- 设置/Provider/工具

**状态**：

```
yoloMode, notificationsEnabled, alwaysOnTop, autoRestoreSessions,
settingsOpen, toolCatalog, toolStatus, providerConfigs
```

**方法**：

```
toggleYoloMode, toggleNotifications, toggleAlwaysOnTop, toggleAutoRestoreSessions,
openSettings, closeSettings,
refreshToolStatus, updateProviderConfig, getEffectiveProvider
```

**依赖**：无外部 slice 依赖。所有方法自包含或仅依赖自身 slice 的状态。

#### todoSlice.js -- TODO

**状态**：

```
todos, todoPanelOpen, todoLastReminderDate, todoChatProvider
```

**方法**：

```
toggleTodoPanel, closeTodoPanel,
addTodo, updateTodo, deleteTodo, toggleTodoDone, clearDoneTodos,
markTodoReminderShown, setTodoChatProvider
```

**依赖**：无外部 slice 依赖。所有方法自包含。

#### miscSlice.js -- 杂项聚合

**状态**：

```
toasts, promptDialog, promptTemplates, groups, broadcastMode, commandPaletteOpen
```

**方法**：

```
addToast, removeToast,
showPrompt,
addPromptTemplate, removePromptTemplate, updatePromptTemplate,
createGroup, removeGroup, renameGroup, moveProjectToGroup, toggleGroupCollapsed,
toggleBroadcastMode, disableBroadcastMode,
toggleCommandPalette, closeCommandPalette
```

**依赖**：`removeGroup` 需要读取 `projects`（来自 coreSlice），因为删除分组时需要将该组下所有项目的 groupId 置空。`removeProject`（coreSlice）需要清理 toasts（miscSlice），但这个通过 `get()` 读取即可。

---

## 4. 依赖图

```
                    coreSlice
                   /    |     \
                  v     v      v
          splitSlice  miscSlice  (被 miscSlice 读取 projects)
              |
              v
         (coreSlice 内 setActiveSession 读 splitPane)
```

**关键依赖说明**：

| 依赖方向 | 读取方式 | 场景 |
|----------|----------|------|
| coreSlice -> splitSlice | `get().splitPane` | removeSession 检查分屏参与者；setActiveSession 检查是否关闭分屏 |
| splitSlice -> coreSlice | `get().activeSessionId`, `get().projects` | openSplit 校验；swapSplitSessions 交换 |
| miscSlice -> coreSlice | `get().projects` | removeGroup 将项目移回未分组 |
| coreSlice -> miscSlice | `get().toasts` | removeProject 清理相关 toasts |

因为 Zustand slice pattern 中所有 slice 共享同一个 `get()`，跨 slice 读取是安全的 -- 只要在 `create()` 组合时所有 slice 已合并。依赖是运行时的（通过 `get()` 延迟读取），不是模块加载时的，所以不存在循环依赖问题。

---

## 5. sessions.js 入口文件设计

拆分后的 `sessions.js` 只负责三件事：

### 5.1 组合 slices

```javascript
import { create } from 'zustand';
import { createCoreSlice } from './slices/coreSlice';
import { createSplitSlice } from './slices/splitSlice';
import { createUISlice } from './slices/uiSlice';
import { createSettingsSlice } from './slices/settingsSlice';
import { createTodoSlice } from './slices/todoSlice';
import { createMiscSlice } from './slices/miscSlice';

const sliceCombiner = (...slices) => (set, get, api) => {
  const sliceResults = slices.map((slice) => slice(set, get, api));
  return Object.assign({}, ...sliceResults);
};

export const useSessionStore = create(
  sliceCombiner(
    createCoreSlice,
    createSplitSlice,
    createUISlice,
    createSettingsSlice,
    createTodoSlice,
    createMiscSlice,
  )
);
```

### 5.2 persist() 方法

**persist() 留在 coreSlice 中**，因为它需要 `get()` 读取所有 slice 的持久化字段。位置不变，行为不变。

```javascript
persist: () => {
  const {
    projects, activeSessionId, yoloMode, notificationsEnabled,
    providerConfigs, theme, sidebarWidth, gitPanelWidth, fileTreeWidth,
    previewPanelWidth, todoPanelWidth, autoRestoreSessions, promptTemplates,
    groups, todos, todoLastReminderDate, todoChatProvider,
  } = get();
  // ... 与现在完全相同的 saveConfig 调用
};
```

### 5.3 init() 方法

**init() 留在 coreSlice 中**，因为它需要 `set()` 写入多个 slice 的状态。init 内部的 `set()` 调用保持不变 -- Zustand 的 `set()` 会合并到整个 store，不区分 slice。

### 5.4 常量

`DEFAULT_CONFIG`、`PROJECT_TEMPLATES`、`BUILTIN_PROMPT_TEMPLATES`、`COMMON_MEMORY` 这些常量根据使用位置拆分：

| 常量 | 目标文件 |
|------|----------|
| `DEFAULT_CONFIG` | `coreSlice.js` |
| `PROJECT_TEMPLATES` | `coreSlice.js` |
| `COMMON_MEMORY` | `coreSlice.js` |
| `BUILTIN_PROMPT_TEMPLATES` | `miscSlice.js`（或保留在 sessions.js 中 export 给 coreSlice 的 init 使用） |

---

## 6. persist 兼容性

### 6.1 核心：JSON 格式不变

拆分后 `get()` 返回的对象结构与拆分前完全相同（所有 slice 合并后是同一个扁平对象）。因此：

- `persist()` 的 `saveConfig()` 入参字段名和结构不变
- 用户磁盘上的 `~/.ai-terminal-manager.json` 不需要迁移
- `loadConfig()` 返回的 JSON 直接解构到 `init()` 的 `set()` 中，不变

### 6.2 验证方式

拆分后写一个简单的测试：

```javascript
// 拆分前
const beforeKeys = Object.keys(useSessionStore.getState()).sort();

// 拆分后
const afterKeys = Object.keys(useSessionStore.getState()).sort();

// 应完全一致（除了新增 slice 不会引入新顶层 key）
assert.deepEqual(beforeKeys, afterKeys);
```

---

## 7. 组件消费方式

### 7.1 import 路径不变

所有组件保持：

```javascript
import { useSessionStore } from '../store/sessions';
```

不需要改任何一个组件的 import 语句。

### 7.2 消费方式不变

组件内的 selector 用法完全不变：

```javascript
const toolCatalog = useSessionStore((s) => s.toolCatalog);
const broadcastMode = useSessionStore((s) => s.broadcastMode);
```

### 7.3 非目标：不改变组件的订阅粒度

本次拆分的目标是文件组织，不是优化重渲染。组件如果已有精确 selector（大部分已经有了），不需要改。如果用了 `useSessionStore()` 解构（如 Sidebar、App、SettingsModal），也不需要改 -- 重渲染优化是后续独立 Task。

---

## 8. 实施步骤

按依赖关系从叶子到根的顺序拆分。每步完成后运行 `npm test` 确认不破坏。

### Step 1: todoSlice (无外部依赖，最安全)

1. 新建 `src/store/slices/` 目录
2. 新建 `src/store/slices/todoSlice.js`
3. 从 sessions.js 剪切以下状态和方法到 todoSlice：
   - 状态：`todos, todoPanelOpen, todoPanelWidth, todoLastReminderDate, todoChatProvider`
   - 方法：`toggleTodoPanel, closeTodoPanel, addTodo, updateTodo, deleteTodo, toggleTodoDone, clearDoneTodos, markTodoReminderShown, setTodoChatProvider`
4. 在 todoSlice 中导出 `createTodoSlice` 函数：`(set, get) => ({ ... })`
5. 修改 sessions.js：import `createTodoSlice`，在 `create()` 中组合
6. 运行 `npm test`

**改动文件**：
- `src/store/sessions.js`（删除 todo 相关代码，添加 import 和组合）
- `src/store/slices/todoSlice.js`（新建）

**不改动**：任何组件文件

### Step 2: miscSlice (仅依赖 coreSlice 的 projects)

1. 新建 `src/store/slices/miscSlice.js`
2. 剪切以下内容：
   - 常量：`BUILTIN_PROMPT_TEMPLATES`
   - 状态：`toasts, promptDialog, promptTemplates, groups, broadcastMode, commandPaletteOpen`
   - 方法：`addToast, removeToast, showPrompt, addPromptTemplate, removePromptTemplate, updatePromptTemplate, createGroup, removeGroup, renameGroup, moveProjectToGroup, toggleGroupCollapsed, toggleBroadcastMode, disableBroadcastMode, toggleCommandPalette, closeCommandPalette`
3. `removeGroup` 内部通过 `get().projects` 和 `get().persist()` 跨 slice 访问 -- 无需改动逻辑
4. 运行 `npm test`

**改动文件**：
- `src/store/sessions.js`
- `src/store/slices/miscSlice.js`（新建）

### Step 3: settingsSlice (无外部依赖)

1. 新建 `src/store/slices/settingsSlice.js`
2. 剪切以下内容：
   - 状态：`yoloMode, notificationsEnabled, alwaysOnTop, autoRestoreSessions, settingsOpen, toolCatalog, toolStatus, providerConfigs`
   - 方法：`toggleYoloMode, toggleNotifications, toggleAlwaysOnTop, toggleAutoRestoreSessions, openSettings, closeSettings, refreshToolStatus, updateProviderConfig, getEffectiveProvider`
3. `getEffectiveProvider` 内部读取 `get().toolCatalog` 和 `get().providerConfigs` -- 都在本 slice 内，无需改
4. 运行 `npm test`

**改动文件**：
- `src/store/sessions.js`
- `src/store/slices/settingsSlice.js`（新建）

### Step 4: uiSlice (无外部依赖)

1. 新建 `src/store/slices/uiSlice.js`
2. 剪切以下内容：
   - 状态：`fileTreeOpen, gitPanelOpen, previewPanelOpen, filePreview, theme, sidebarWidth, gitPanelWidth, fileTreeWidth, previewPanelWidth, todoPanelWidth`
   - 方法：`toggleFileTree, closeFileTree, toggleGitPanel, closeGitPanel, openFilePreview, closeFilePreview, togglePreviewPanel, setTheme, setSidebarWidth, commitSidebarWidth, setPanelWidth, commitPanelWidth`
3. `setTheme` 调用 `get().persist()` -- 跨 slice 但通过 `get()` 延迟读取，无需改
4. 运行 `npm test`

**改动文件**：
- `src/store/sessions.js`
- `src/store/slices/uiSlice.js`（新建）

### Step 5: splitSlice (依赖 coreSlice)

1. 新建 `src/store/slices/splitSlice.js`
2. 剪切以下内容：
   - 状态：`splitPane`
   - 方法：`openSplit, closeSplit, setSplitRatio, swapSplitSessions`
3. `openSplit` 内部通过 `get().activeSessionId` 和 `get().projects` 跨 slice -- 无需改逻辑
4. 运行 `npm test`

**改动文件**：
- `src/store/sessions.js`
- `src/store/slices/splitSlice.js`（新建）

### Step 6: coreSlice (最后剩余)

1. 新建 `src/store/slices/coreSlice.js`
2. 剪切以下内容：
   - 常量：`DEFAULT_CONFIG, PROJECT_TEMPLATES, COMMON_MEMORY`
   - 状态：`projects, activeSessionId, isLoading, now, sessionStatus`
   - 方法：`tickNow, init, persist, updateSessionStatus, syncSessionNamesToMain, addProject, removeProject, renameProject, updateProjectPath, createProjectFromTemplate, addSession, removeSession, renameSession, setActiveSession, setSessionByIndex, addSessionToActiveProject, closeActiveSession, getActiveProject, getActiveSession`
3. `sessions.js` 只保留 import + create + sliceCombiner
4. 运行 `npm test`

**改动文件**：
- `src/store/sessions.js`（精简为约 30 行的组合入口）
- `src/store/slices/coreSlice.js`（新建）

### Step 7: 验收

1. `npm test` 全部通过
2. `npm start` 启动应用，验证：
   - 项目/会话 CRUD 正常
   - 分屏打开/关闭/拖拽正常
   - 设置面板打开/配置保存/重启后恢复
   - TODO 面板/CRUD/每日提醒正常
   - Prompt 模板/Toast/Group 正常
   - Broadcast/CommandPalette 正常
   - 面板拖拽宽度/主题切换正常
3. 检查 `~/.ai-terminal-manager.json` 格式与拆分前一致

---

## 9. 每个 Slice 的函数签名模板

每个 slice 文件遵循统一格式：

```javascript
// src/store/slices/xxxSlice.js

import { v4 as uuidv4 } from 'uuid';  // 按需
const { ... } = require('../sessionState');  // 按需

export const createXxxSlice = (set, get) => ({
  // ── 状态 ──────────────────────────────────────────────
  someField: defaultValue,

  // ── 方法 ──────────────────────────────────────────────
  someMethod: (param) => {
    set((s) => ({ someField: newValue }));
    get().persist();  // 按需调用
  },
});
```

---

## 10. In-scope / Out-of-scope

### In-scope（本次必做）

- 将 sessions.js 拆分为 6 个 slice 文件 + 1 个组合入口
- 保持 persist() 的 JSON 格式不变
- 保持所有组件的 import 路径不变
- 保持所有现有测试通过
- 更新 src/CLAUDE.md 中 Zustand Store 结构章节

### Out-of-scope（本次明确不做）

1. **组件 selector 优化**：部分组件（Sidebar、App、SettingsModal）用 `useSessionStore()` 解构取值导致过宽订阅。这是独立的性能优化 Task，不在本次范围内。理由：拆分 slice 后，组件层面的 selector 优化需要逐个组件分析渲染频率，与文件组织是两个维度。
2. **状态字段重命名**：不改动任何字段名。理由：重命名会同时影响 persist 格式和所有组件。
3. **persist 机制升级**：不引入 Zustand middleware/persist 插件。理由：当前手动 `persist()` 调用虽繁琐但可控，引入 middleware 是架构层变更。
4. **sessionState.js 纯函数拆分**：该文件 96 行，职责清晰，不需要拆分。
5. **新增测试**：slice 拆分是结构性重构，不新增测试用例。现有测试通过即为验收标准。

### 边界依据

本次拆分的核心价值是**文件组织**和**可维护性**，不是运行时性能。Zustand 单 store 内拆 slice 对重渲染没有影响（重渲染由 selector 精度决定），所以组件 selector 优化单独排期。

### 违反边界的后果

开发若在拆分过程中"顺手"引入了 selector 优化、字段重命名、或 middleware，必须通过 BLOCKED 回归方案复核。范围蔓延是这类重构最常见的失败模式。

---

## 11. 风险点

| 风险 | 影响 | 缓解 |
|------|------|------|
| init() 跨多个 slice 写入 set() | init 内部 `set({ projects, activeSessionId, yoloMode, ... })` 一次性写入多个 slice 的字段 | init 留在 coreSlice 中，Zustand 的 `set()` 是合并到整个 store 的，不区分 slice 来源。不需要改。 |
| persist() 跨 slice 读取 get() | persist 需要从 6 个 slice 取 17 个字段 | persist 留在 coreSlice 中，`get()` 返回合并后的完整 store，不需要改。 |
| slice 组合顺序 | 理论上 slice 合并顺序影响同名字段覆盖 | 所有 slice 的字段名不重叠（已验证），组合顺序无影响。 |
| 循环依赖 | slice A import slice B，slice B import slice A | slice 之间不互相 import。跨 slice 访问全部通过 `get()` 运行时读取。slice 只 import `sessionState.js` 纯函数。 |

---

## 12. Definition of Done

1. `sessions.js` 不超过 50 行（仅 import + sliceCombiner + create）
2. 6 个 slice 文件各自不超过 200 行
3. `npm test` 全部通过，无新增失败
4. `npm start` 启动后所有功能与拆分前一致（手动验证清单见 Step 7）
5. 用户磁盘 `~/.ai-terminal-manager.json` 格式不变
6. 所有组件文件零改动（import 路径不变、selector 不变）
