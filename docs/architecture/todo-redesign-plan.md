# TODO 面板重构方案：项目联动 + 任务聚焦

> 版本: 1.0 | 日期: 2026-04-18 | 状态: 待评审

---

## 1. 背景与问题

**现状**：TODO 数据模型是全局一维数组 `todos: [{ id, text, done, priority, createdAt, doneAt, dueDate }]`，无项目关联。TodoPanel 是平铺列表，TodoAIChat 不感知项目上下文。

**用户痛点**：无法直观看出"哪个项目有哪些 TODO"、"当前正在进行哪个任务"。侧边栏和 TODO 面板是两个割裂的信息孤岛。

**核心目标**：
- TODO 按项目关联，侧边栏能看到 badge
- TODO 面板按项目分组，当前项目置顶
- AI 助手感知项目上下文
- 数据迁移不丢用户现有 TODO

---

## 2. 新数据模型

### 2.1 现状（问题根源）

```
// sessions.js store state
todos: [{ id, text, done, priority, createdAt, doneAt, dueDate }]   // 全局平铺
```

问题：没有 `projectId` 字段，无法关联到项目。

### 2.2 目标模型

**方案选择**：在 todo 对象上增加 `projectId` 字段，而不是嵌套到 project 内部。

**取舍理由**：
- **候选 A（嵌套）**：把 todos 放进 `project.todos`。改动大，所有 todo 操作需要先找 project，persist 时全量序列化 project 对象，sidebar 读取 todo count 要遍历 project。
- **候选 B（扁平 + 外键）**：todo 加 `projectId` 字段，保持全局一维数组。改动最小，查询用 `todos.filter(t => t.projectId === p.id)`，与现有 `addTodo / deleteTodo / toggleTodoDone` 等方法的签名兼容（只多传一个 projectId）。

**选择候选 B**，理由：最小变更、向后兼容、不破坏现有 CRUD 方法签名。

```javascript
// 新的 todo 对象结构
{
  id: 'todo-1713400000000-a1b2c',
  text: '完成登录模块重构',
  done: false,
  priority: 'high',           // 'none' | 'low' | 'medium' | 'high'
  createdAt: 1713400000000,
  doneAt: null,
  dueDate: '2026-04-20',      // YYYY-MM-DD | null
  projectId: 'proj-xxxx',     // 新增：关联项目 ID，null 表示全局/未分配
  status: 'todo',             // 新增：'todo' | 'in_progress' | 'done'
}
```

**`projectId` 语义**：
- 值为具体 project.id：属于该项目的 TODO
- 值为 `null`：全局 TODO（不属于任何项目，兜底使用场景）

**`status` 字段新增语义**：
- `todo`：待办（默认，替代原来 `done: false`）
- `in_progress`：正在进行（**核心新增**，满足"当前正在进行哪个任务"的需求）
- `done`：已完成（替代原来 `done: true`）

**向后兼容**：`done` 字段保留作为冗余标志（`status === 'done'` <=> `done === true`），避免一次性改所有读取 `done` 的地方。新增的 `status` 字段缺省时从 `done` 推导：如果 todo 对象没有 `status`，则 `status = done ? 'done' : 'todo'`。

### 2.3 Store 字段变更

```javascript
// sessions.js store 新增字段
todoFocusProjectId: null,   // TODO 面板当前聚焦的项目 ID（null = 全部）
```

不需要新增 store state。`todoFocusProjectId` 是 UI 层面的焦点状态，初始值跟随 `activeSessionId` 推导出的项目。

### 2.4 新增/修改的 Store 方法

```javascript
// 修改签名的方法（增加 projectId 参数）
addTodo(text, priority, dueDate, projectId)   // projectId 可选，缺省取 todoFocusProjectId

// 新增方法
setTodoFocusProject(projectId)                 // 设置面板焦点项目
setTodoStatus(id, status)                      // 设置 todo 的 status（'todo' | 'in_progress' | 'done'）

// 派生方法
getTodosByProject(projectId)                   // 获取指定项目的 todos
getActiveTodoCount(projectId)                  // 获取指定项目的未完成 todo 数量
getGlobalActiveTodoCount()                     // 获取所有未完成 todo 数量
```

---

## 3. 数据迁移策略

### 3.1 迁移场景

现有用户已有全局 TODO，没有 `projectId`。升级后这些 TODO 的 `projectId` 为 `null`（全局 TODO），用户可以后续手动分配。

### 3.2 迁移时机

在 `init()` 函数中加载配置后，一次性迁移：

```javascript
// sessions.js init() 内，config 加载后
const todos = (config.todos || []).map((t) => ({
  ...t,
  // 补充新字段，保留旧字段
  projectId: t.projectId ?? null,        // 旧数据没有 projectId，默认 null
  status: t.status ?? (t.done ? 'done' : 'todo'),  // 旧数据没有 status，从 done 推导
}));
```

### 3.3 迁移原则

- **不丢数据**：所有旧字段原样保留
- **零停机**：迁移在 init() 同步完成，用户无感知
- **可回滚**：旧版本的代码仍然能读取新的 todo 对象（新增字段被忽略）

### 3.4 清理已删除项目的孤儿 TODO

在 init() 迁移阶段，检查是否存在 `projectId` 指向已不存在的项目的 TODO，将这些 TODO 的 `projectId` 设为 `null`。

```javascript
// init() 迁移后
const validProjectIds = new Set(projects.map((p) => p.id));
todos.forEach((t) => {
  if (t.projectId && !validProjectIds.has(t.projectId)) {
    t.projectId = null;
  }
});
```

---

## 4. UI 组件结构

### 4.1 侧边栏变更：项目名旁显示 TODO badge

**改动文件**：`src/components/sidebar/ProjectSection.jsx`

**具体改动**：
- 从 store 读取 `todos`
- 计算当前项目的未完成 TODO 数量
- 在项目名右侧（hover 操作按钮之前）显示 badge

**badge 样式**：
- 圆角小胶囊，`fontSize: 10`，`background: #1a2a3a`，`color: #60a5fa`
- 数量为 0 时不显示
- 有逾期（overdue）的高优先级任务时，badge 变色为 `background: #3a1a1a`，`color: #ef4444`

**位置**：放在 `EditableLabel` 和 hover 操作按钮之间，与 `groupCount` 样式一致。

```jsx
{/* TODO badge -- 在项目名右侧 */}
{(() => {
  const count = todos.filter(t => t.projectId === project.id && t.status !== 'done').length;
  if (count === 0) return null;
  const hasOverdue = todos.some(t =>
    t.projectId === project.id && t.status !== 'done' && t.dueDate &&
    t.dueDate < new Date().toISOString().slice(0, 10)
  );
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 600,
      padding: '1px 5px',
      borderRadius: 10,
      background: hasOverdue ? '#3a1a1a' : '#1a2a3a',
      color: hasOverdue ? '#ef4444' : '#60a5fa',
      border: `1px solid ${hasOverdue ? '#5a2828' : '#2a4a6a'}`,
      flexShrink: 0,
    }}>
      {count}
    </span>
  );
})()}
```

### 4.2 侧边栏变更：点击项目时 TODO 面板聚焦

**改动文件**：`src/components/sidebar/ProjectSection.jsx`

**具体改动**：
- 给项目 header 的 `onClick` 追加调用 `setTodoFocusProject(project.id)`
- 如果 TODO 面板已打开，聚焦到该项目的 TODO 列表

```javascript
// ProjectSection.jsx onClick handler
onClick={() => {
  setCollapsed((c) => !c);
  setTodoFocusProject(project.id);
}}
```

### 4.3 TodoPanel 重构：按项目分组展示

**改动文件**：`src/components/TodoPanel.jsx`

**核心结构变更**（自上而下）：

```
TodoPanel
  +-- Header（标题 + badge + 关闭按钮）
  +-- ProjectSelector（项目切换 tab 或下拉）
  +-- Progress bar（当前项目的进度）
  +-- Filter tabs（进行中 / 全部 / 已完成）
  +-- TodoList
  |     +-- ProjectGroup（项目 A，如果选中"全部"才出现）
  |     |     +-- ProjectGroupHeader（项目名 + count + 展开按钮）
  |     |     +-- TodoItem x N
  |     +-- ProjectGroup（项目 B...）
  |     +-- GlobalGroup（全局 TODO，projectId === null）
  +-- Footer（清除已完成）
  +-- TodoAIChat
```

**两种视图模式**：

1. **聚焦模式**（`todoFocusProjectId !== null`）：只显示当前项目的 TODO 列表。这是默认模式，自动跟随侧边栏选中的项目。
2. **全部模式**（`todoFocusProjectId === null`）：按项目分组展示所有 TODO，当前项目组置顶且有高亮背景。

**ProjectSelector 的具体实现**：

在 filter tabs 上方增加一个横向滚动的项目选择条：

```jsx
<div style={{ display: 'flex', gap: 4, padding: '0 10px', overflowX: 'auto' }}>
  <button
    onClick={() => setTodoFocusProject(null)}
    style={{ /* 全部按钮样式 */ }}
  >
    全部
  </button>
  {projects.map((p) => {
    const count = todos.filter(t => t.projectId === p.id && t.status !== 'done').length;
    return (
      <button
        key={p.id}
        onClick={() => setTodoFocusProject(p.id)}
        style={{
          /* 项目按钮样式，选中时高亮 */
          background: todoFocusProjectId === p.id ? '#1a2840' : 'transparent',
          borderBottom: todoFocusProjectId === p.id ? '1px solid #60a5fa' : 'none',
        }}
      >
        {p.name} {count > 0 && `(${count})`}
      </button>
    );
  })}
</div>
```

### 4.4 TodoItem 新增：进行中状态视觉区分

**改动文件**：`src/components/TodoPanel.jsx` 内的 `TodoItem` 组件

**`in_progress` 状态的视觉表现**：
- 左侧边框变为动画渐变脉冲色（`#f59e0b` amber）
- 整行背景微亮：`background: rgba(245, 158, 11, 0.05)`
- checkbox 区域显示一个小的旋转进度指示器（替代空 checkbox）
- 文字颜色比普通 todo 稍亮：`color: '#f0f0f0'`（对比普通 `#d4d4d4`）

**操作按钮新增**：
- 在 hover 操作中增加 "开始" / "暂停" 按钮（`status` 在 `'todo'` 和 `'in_progress'` 之间切换）

```jsx
{/* 状态切换按钮 */}
{!todo.done && (
  <button
    onClick={() => setTodoStatus(todo.id, todo.status === 'in_progress' ? 'todo' : 'in_progress')}
    style={itemStyles.actionBtn}
    title={todo.status === 'in_progress' ? '暂停任务' : '开始任务'}
  >
    {todo.status === 'in_progress' ? '⏸' : '▶'}
  </button>
)}
```

### 4.5 AddForm 变更：新增项目选择

**改动文件**：`src/components/TodoPanel.jsx` 内的 `AddForm` 组件

**具体改动**：
- 在优先级选择和日期选择之间增加项目选择下拉框
- 默认选中 `todoFocusProjectId` 对应的项目
- 选项包含"（全局）"和所有项目名称

```jsx
<select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
  <option value="">（全局）</option>
  {projects.map((p) => (
    <option key={p.id} value={p.id}>{p.name}</option>
  ))}
</select>
```

### 4.6 TodoAIChat 变更：项目上下文感知

**改动文件**：
- `src/components/TodoAIChat.jsx`（renderer）
- `electron/todoAI.js`（main process）

**具体改动**：

1. **渲染进程**：`runChat()` 调用时，额外传递当前焦点项目和当前用户正在操作的会话信息：

```javascript
const focusProject = useSessionStore((s) => {
  if (s.todoFocusProjectId) {
    return s.projects.find(p => p.id === s.todoFocusProjectId);
  }
  // 退回到 activeSession 推导
  return s.projects.find(p => p.sessions.some(sess => sess.id === s.activeSessionId));
});

// runChat 时传递
window.electronAPI.startTodoChat({
  providerId: todoChatProvider,
  providerConfigs,
  messages: msgs,
  todos,
  projectContext: focusProject ? { id: focusProject.id, name: focusProject.name, path: focusProject.path } : null,
});
```

2. **主进程**：`buildSystemPrompt` 增加项目上下文：

```javascript
function buildSystemPrompt(todos, projectContext) {
  // ...existing code...

  const projectSection = projectContext
    ? `## 当前项目\n项目名称: ${projectContext.name}\n项目路径: ${projectContext.path}\n\n用户正在这个项目下工作，优先管理该项目的待办。`
    : '';

  return `你是智枢 (ZhiShu) AI 终端管理器内置的待办助手。帮助用户高效管理开发工作的待办事项。

${projectSection}

## 今日
${today}

## 当前待办列表
${todoList}

## 工作原则
...（现有原则保留）
- 如果用户说"加个 TODO"、"记一下"，默认添加到当前项目 (${projectContext?.name || '全局'})
- 可以用 projectId 字段指定项目`;
}
```

3. **工具定义变更**：`add_todo` 和 `bulk_create_todos` 的 input_schema 增加 `projectId` 字段：

```javascript
{
  name: 'add_todo',
  input_schema: {
    type: 'object',
    properties: {
      text:      { type: 'string', description: '待办内容' },
      priority:  { /* ... */ },
      dueDate:   { /* ... */ },
      projectId: { type: 'string', description: '关联项目的 ID，不填则使用当前项目' },
    },
    required: ['text'],
  },
}
```

4. **工具执行变更**：`TodoAIChat.jsx` 中 `executeTool` 的 `add_todo` case 使用传入的 `projectId`（或缺省当前焦点项目）：

```javascript
case 'add_todo':
  addTodo(input.text, input.priority || 'none', input.dueDate || null,
          input.projectId || focusProject?.id || null);
  return `已添加待办: "${input.text}"${input.projectId ? ` (项目: ${input.projectId})` : ''}`;
```

---

## 5. 组件间数据流

### 5.1 数据流图

```
sessions.js (Zustand Store)
  |
  +-- projects[] ----+---- Sidebar.jsx ---- ProjectSection.jsx
  |                  |                          |
  |                  |                    读取 todos 计算 badge count
  |                  |                    onClick -> setTodoFocusProject()
  |                  |
  +-- todos[] -------+---- TodoPanel.jsx
  |    (全局一维,       |       |
  |     含 projectId)  |       +-- ProjectSelector (读写 todoFocusProjectId)
  |                  |       +-- TodoList (按 projectId 过滤)
  |                  |       +-- AddForm (选择 projectId)
  |                  |       +-- TodoItem (显示 status, 切换 status)
  |                  |
  |                  +---- TodoAIChat.jsx
  |                          |
  |                          +-- 传递 projectContext 给 main process
  |                          +-- executeTool 传递 projectId
  |
  +-- todoFocusProjectId
  +-- activeSessionId (推导当前项目)

todoAI.js (Main Process)
  |
  +-- buildSystemPrompt(todos, projectContext) -- 增加"当前项目" section
  +-- TODO_TOOLS -- add_todo 增加 projectId 参数
```

### 5.2 关键交互流

**流 A：用户在侧边栏点击项目 -> TODO 面板聚焦**

1. 用户点击 ProjectSection header
2. `ProjectSection.onClick` -> `setTodoFocusProject(project.id)`
3. `TodoPanel` 订阅 `todoFocusProjectId` 变化 -> 切换到聚焦模式
4. 列表只显示该项目的 TODO
5. `TodoAIChat` 重新推导 `focusProject` -> AI 上下文更新

**流 B：用户在侧边栏看到 badge -> 打开 TODO 面板**

1. `ProjectSection` 渲染时读取 `todos`，计算该项目未完成 count
2. count > 0 时显示 badge
3. 用户点击 badge 或项目名 -> `setTodoFocusProject` + 打开 TODO 面板（如果未打开）

**流 C：用户在 TODO 面板添加 TODO -> badge 更新**

1. 用户在 AddForm 选择项目，输入内容，点击添加
2. `addTodo(text, priority, dueDate, projectId)` -> store 更新
3. `ProjectSection` 重新计算 badge count -> badge 实时更新
4. `persist()` 保存到配置文件

**流 D：AI 助手添加 TODO -> 自动关联当前项目**

1. 用户对 AI 说"加个 TODO：完成数据库迁移"
2. `runChat` 传递 `projectContext`（当前焦点项目）
3. Main process `buildSystemPrompt` 包含项目信息
4. AI 调用 `add_todo` tool，`projectId` 缺省 -> renderer 侧用 `focusProject.id` 补全
5. 新 TODO 的 `projectId` 指向当前项目

---

## 6. 文件级改动清单

### 6.1 In-scope（本次必做）

| 序号 | 文件 | 改动类型 | 具体动作 |
|------|------|----------|----------|
| 1 | `src/store/sessions.js` | 修改 | (1) `addTodo` 签名增加 `projectId` 参数，缺省取 `todoFocusProjectId`；(2) 新增 `setTodoFocusProject`、`setTodoStatus`、`getActiveTodoCount` 方法；(3) 新增 store 字段 `todoFocusProjectId`；(4) `init()` 中加数据迁移逻辑；(5) `persist()` 中保存 `todoFocusProjectId`；(6) `toggleTodoDone` 改为同步 `done` 和 `status` 两个字段；(7) `clearDoneTodos` 过滤条件改为 `status !== 'done'`；(8) `removeProject` 时清理关联 TODO 的 `projectId`（设为 null） |
| 2 | `src/components/TodoPanel.jsx` | 修改 | (1) 新增 `ProjectSelector` 子区域；(2) `TodoItem` 增加 `in_progress` 状态视觉和切换按钮；(3) `AddForm` 增加项目选择下拉框；(4) 过滤逻辑按 `todoFocusProjectId` 过滤；(5) 排序增加 `in_progress` 置顶；(6) 全部模式下按 `projectId` 分组渲染 |
| 3 | `src/components/TodoAIChat.jsx` | 修改 | (1) `runChat` 增加 `projectContext` 参数；(2) `executeTool` 的 `add_todo` case 使用 `projectId`；(3) 订阅 `todoFocusProjectId` 变化 |
| 4 | `src/components/sidebar/ProjectSection.jsx` | 修改 | (1) 从 store 读取 `todos`；(2) 项目名右侧渲染 TODO badge；(3) `onClick` 追加 `setTodoFocusProject` 调用 |
| 5 | `electron/todoAI.js` | 修改 | (1) `buildSystemPrompt` 增加 `projectContext` 参数和项目上下文 section；(2) `TODO_TOOLS` 中 `add_todo` / `bulk_create_todos` 增加 `projectId` 字段定义；(3) `startChatStream` 签名增加 `projectContext`，传递给 `buildSystemPrompt` |
| 6 | `electron/preload.js` | 无需改动 | `startTodoChat` 已经透传整个 opts 对象，新增字段自动传递 |

### 6.2 Out-of-scope（本次明确不做）

| 项目 | 理由 |
|------|------|
| TODO 拖拽排序 | 用户需求未提及，后续独立 Task |
| TODO 多人协作/同步 | 超出单机应用范畴 |
| TODO 与 Git commit 关联 | 需要架构层支持，后续独立 Task |
| 侧边栏项目名旁显示"正在进行的任务名" | 信息密度过高，badge count 已够用，后续看用户反馈 |
| TODO 面板内嵌项目详情 | 不是面板职责，项目信息在侧边栏 |
| Light 主题适配 | 现有 light 主题本身未完整实现，不是本次范围 |
| TODO 自动从 AI 对话提取 | 需要 NLP 能力，后续独立 Task |

### 6.3 边界依据

- **业务边界**：用户原话是"能看出来哪个项目有哪个 TODO"，核心是数据关联和视觉呈现，不涉及复杂的工作流引擎。
- **技术边界**：只涉及 Zustand store 字段扩展和 React 组件改造，不涉及 Electron 主进程架构变更（todoAI.js 改动仅在 prompt 和 tool schema 层面）。
- **成本边界**：预估 6 个文件改动，总计约 400-500 行变更，1 个开发日可完成。

### 6.4 违反边界的后果

开发若越界（如自作主张加拖拽排序、加 Git 关联），必须通过 BLOCKED 回归方案复核，不得静默扩大范围。每多一个文件、多一个功能点，测试和回归的风险指数级增长。

---

## 7. 实施步骤

### Step 1：Store 层数据模型扩展

**文件**：`src/store/sessions.js`

1. 新增 `todoFocusProjectId: null` 字段
2. `init()` 中增加数据迁移：旧 todo 补 `projectId: null` 和 `status` 字段，清理孤儿 projectId
3. 修改 `addTodo(text, priority = 'none', dueDate = null, projectId = undefined)`：
   - 如果 `projectId` 为 `undefined`（未传），取 `get().todoFocusProjectId`
   - 新 todo 的 `status` 默认 `'todo'`
4. 新增 `setTodoFocusProject(projectId)`
5. 新增 `setTodoStatus(id, status)`：同步更新 `done` 和 `status`
6. 修改 `toggleTodoDone(id)`：内部调用 `setTodoStatus`
7. 修改 `clearDoneTodos()`：过滤条件 `t.status !== 'done'`
8. 修改 `removeProject(projectId)`：关联 TODO 的 projectId 置 null
9. `persist()` 中增加 `todoFocusProjectId`

**验证点**：启动应用后，旧数据能正确加载，旧 TODO 的 `status` 和 `projectId` 被正确推导。

### Step 2：侧边栏 Badge + 联动

**文件**：`src/components/sidebar/ProjectSection.jsx`

1. 从 store 读取 `todos` 和 `setTodoFocusProject`
2. 在 `EditableLabel` 右侧、hover actions 左侧，渲染 TODO badge
3. 项目 header `onClick` 追加 `setTodoFocusProject(project.id)`

**验证点**：侧边栏项目名右侧出现未完成 TODO 数量 badge；点击项目后 `todoFocusProjectId` 更新。

### Step 3：TodoPanel 按项目分组

**文件**：`src/components/TodoPanel.jsx`

1. 新增 `ProjectSelector` 区域（横向 tab 或下拉，按需求选择）
2. 过滤逻辑：根据 `todoFocusProjectId` 过滤 todos
3. 排序逻辑：`in_progress` 置顶，然后 overdue，然后 priority，最后 createdAt
4. 全部模式（`todoFocusProjectId === null`）时按 projectId 分组渲染，当前项目组置顶
5. `AddForm` 增加项目选择 select
6. `TodoItem` 增加 `in_progress` 视觉（背景色、脉冲边框、状态切换按钮）

**验证点**：
- 切换项目 tab 时列表正确过滤
- `in_progress` 的 TODO 有明显视觉区分
- 全部模式下按项目分组，当前项目置顶
- 添加 TODO 时可以选择项目

### Step 4：AI 助手项目上下文

**文件**：`electron/todoAI.js` + `src/components/TodoAIChat.jsx`

1. `buildSystemPrompt` 增加 `projectContext` 参数，生成"当前项目"section
2. `TODO_TOOLS` 中 `add_todo` 增加 `projectId` 字段
3. `TodoAIChat.jsx` 中推导 `focusProject`，传递 `projectContext`
4. `executeTool` 的 `add_todo` case 使用 `projectId`

**验证点**：
- AI 能感知当前项目名称和路径
- AI 添加的 TODO 自动关联当前项目
- 对 AI 说"加个 TODO"，新 TODO 出现在正确项目下

---

## 8. 主要风险点

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 数据迁移后旧版本无法读取 | 降级回滚时丢数据 | 新增字段（`projectId`, `status`）都是可选的，旧代码忽略它们不影响功能 |
| `in_progress` 状态与现有 `done` 字段不同步 | 状态不一致 | `setTodoStatus` 方法内部同步两个字段：`status === 'done'` 时 `done = true`，否则 `done = false` |
| badge 计算性能（每次渲染遍历所有 todos） | 项目多时卡顿 | badge 计算是 O(n) 线性遍历，todo 数量通常 < 100，不需要优化。如果未来 todo 达到 1000+ 级别，可用 `useMemo` + 按 projectId 索引优化 |
| 项目删除后 TODO 孤儿 | 删除项目的 TODO 消失 | `removeProject` 时将关联 TODO 的 `projectId` 设为 `null`（归入全局），不删除 TODO |
| 全部模式下分组渲染复杂度 | 列表过长 | 每组默认折叠（只显示 header + count），展开后才显示具体 TODO |

---

## 9. Definition of Done（开发完成标准）

1. **数据层**：所有 todo 对象包含 `projectId` 和 `status` 字段；旧数据升级后自动迁移；`addTodo` / `setTodoStatus` / `setTodoFocusProject` 方法正确工作并持久化
2. **侧边栏联动**：每个项目名右侧显示未完成 TODO 数量 badge（count = 0 时隐藏）；点击项目后 TODO 面板自动聚焦该项目
3. **TODO 面板**：支持按项目切换查看；`in_progress` 状态有视觉区分（脉冲色、高亮背景、状态切换按钮）；添加 TODO 时可选择项目；全部模式下按项目分组展示
4. **AI 助手**：`buildSystemPrompt` 包含当前项目上下文；AI 调用 `add_todo` 时自动关联当前项目
5. **边界情况**：删除项目后关联 TODO 归入全局而不丢失；`projectId` 指向不存在项目的 TODO 归入全局；空项目列表时 TODO 面板正常显示

---

## 10. 升级判断

- **不需要 architect 介入**：本次改动在现有 Zustand store 框架内扩展，不涉及进程间通信架构变更、不涉及新的 IPC channel。
- **不需要 database 介入**：持久化仍使用 JSON 配置文件，不涉及数据库。
- **不需要 visual-designer 介入**：UI 样式沿用现有设计语言（badge 样式参考 groupCount，in_progress 状态色参考 priority high 的 amber 色）。
