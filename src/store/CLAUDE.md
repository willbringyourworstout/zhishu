# src/store/ — Zustand 状态管理

项目唯一状态源。纯函数抽取到 `sessionState.js`，Zustand store 在 `sessions.js`。

**技术栈**: Zustand (persist middleware) / 纯函数
**测试**: `node --test src/store/sessionState.test.js`

## 文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `sessions.js` | 1044 | Zustand store：所有状态 + actions |
| `sessionState.js` | 117 | 纯函数（可独立测试） |
| `sessionState.test.js` | 68 | 纯函数单元测试 |

## sessions.js 核心 API

### 状态分组

| 分组 | 关键字段 |
|------|---------|
| 项目/会话 | `projects`, `activeSessionId`, `sessionStatus`, `sessionNames` |
| 工具/Provider | `toolCatalog`, `toolStatus`, `providerConfigs`, `customProviders` |
| 分组 | `groups`, `groupCollapsed` |
| 分屏 | `splitPane` (sessionId, ratio) |
| TODO | `todos`, `todoFocusProjectId`, `todoChatProvider` |
| 面板 | `fileTreeOpen`, `gitPanelOpen`, `todoPanelOpen`, `previewPanelOpen`, `*Width` |
| 系统 | `systemResources`, `theme`, `now` (5s tick) |
| 弹窗 | `settingsOpen`, `commandPaletteOpen`, `promptDialog`, `toasts` |

### 关键 Actions

- **项目**: `addProject`, `removeProject`, `renameProject`, `updateProjectPath`, `reorderProjects`
- **会话**: `addSession`, `removeSession`, `renameSession`, `setActiveSession`, `reorderSessions`
- **Provider**: `updateProviderConfig`, `addCustomProvider`, `updateCustomProvider`, `removeCustomProvider`, `getEffectiveProvider(tool)`
- **分组**: `createGroup`, `removeGroup`, `renameGroup`, `moveProjectToGroup`, `toggleGroupCollapsed`
- **面板**: `toggleFileTree`, `toggleGitPanel`, `toggleTodoPanel`, `setPanelWidth`, `commitPanelWidth`
- **通知**: `addToast({type, mergeKey, ...})` — mergeKey 支持批量合并
- **弹窗**: `showPrompt({title, defaultValue})` → Promise<string|null>
- **持久化**: `persist()` 方法显式触发，写入 `~/.ai-terminal-manager.json`

## sessionState.js 纯函数

| 函数 | 用途 |
|------|------|
| `getFirstSessionId(projects)` | 获取第一个项目的第一个会话 ID |
| `resolveProjects(projects, providerConfigs, customProviders)` | 解析项目 + Provider 元数据 |
| `resolveActiveSessionId(...)` | 安全获取活跃会话 ID |
| `removeSessionFromProjects(projects, sessionId)` | 从所有项目中移除会话 |
| `reorderProjectsInList(list, fromIdx, toIdx)` | 项目拖拽重排序 |
| `reorderSessionsInProject(project, fromIdx, toIdx)` | 会话拖拽重排序 |
| `resolveGroups(groups, projects)` | 解析分组 + ungrouped |
| `getProjectsByGroup(groups, projects, groupId)` | 按分组获取项目 |
