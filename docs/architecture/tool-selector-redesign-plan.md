# 工具选择器重设计方案

> Task: 将 TerminalView 工具栏左侧的平铺按钮改为下拉选择器，按组分类，支持自定义 Anthropic 格式端点和颜色自定义。

---

## 1. 现状分析

### 当前工具栏结构 (`TerminalView.jsx` L804-866)

工具栏 `toolbarLeft` 区域渲染了两组平铺按钮：
1. **TOOL_ORDER** (`claude, codex, gemini, qwen, opencode`) -- 独立原生工具
2. **PROVIDER_ORDER** (`glm, minimax, kimi, qwencp`) -- 复用 Claude 二进制的 Provider

中间用 `toolGroupDivider` 竖线分隔。每个工具一个 `ToolButton`，占空间 80-100px。总计 9 个按钮 = ~800px，加上右侧 YOLO/通知/置顶/Git/文件树/设置约 200px，总共 ~1000px，在窄屏下极易溢出。

### 数据流

```
electron/tools.js (TOOL_CATALOG + PROVIDER_CATALOG)
  --> IPC tools:catalog
  --> Zustand store.toolCatalog
  --> TerminalView 消费渲染

electron/tools.js (硬编码 PROVIDER_CATALOG)
  --> store.providerConfigs (用户覆盖)
  --> getEffectiveProvider() 合并
  --> buildLaunchCommand() 生成启动命令
```

### 自定义端点的现状

当前 `PROVIDER_CATALOG` 是硬编码的 4 个 Provider (GLM / MiniMax / Kimi / QwenCP)。用户无法添加新的 Anthropic 格式端点。Provider 的视觉元数据（颜色、标签）也是硬编码在 `src/constants/toolVisuals.js`。

---

## 2. 交互设计

### 2.1 新 UI 结构

```
┌──────────────────────────────────────────────────────────────┐
│  [Claude Code v]  │  YOLO  🔔 📌 ☑ 🌿 📁 ⚙                    │
└──────────────────────────────────────────────────────────────┘
         │
         ▼ 点击展开
┌─────────────────────────────────────┐
│  Anthropic 端点                      │
│  ─────────────────────────────────── │
│  ● Claude Code          ◀ 默认      │
│    GLM Code                         │
│    MiniMax Code                     │
│    Qwen Code                        │
│    Kimi Code                        │
│    My Custom Endpoint               │
│  ┌─────────────────────────────┐    │
│  │  + 添加 Anthropic 端点       │    │
│  └─────────────────────────────┘    │
│                                     │
│  独立工具                            │
│  ─────────────────────────────────── │
│  Codex                              │
│  Gemini CLI                         │
└─────────────────────────────────────┘
```

### 2.2 交互细节

| 操作 | 行为 |
|------|------|
| 点击选择器主体 | 展开下拉列表 |
| 再次点击或点击空白 | 收起列表 |
| 选择一个工具 | 收起列表 + 立即启动该工具（与当前 ToolButton 行为一致） |
| Shift + 点击工具 | 续接上次会话（`--continue`） |
| 点击「添加 Anthropic 端点」 | 打开内联添加表单（在设置弹窗的 Provider tab 里追加一个空白卡片） |
| 选择器显示当前选中 | 工具名 + 品牌色圆点。无工具选中时显示 "选择工具" |

### 2.3 选择器主体视觉

```
┌─────────────────────────┐
│  ◆ Claude Code      ▾  │    ← 品牌色圆点 + 工具名 + 下拉箭头
└─────────────────────────┘
```

- 宽度: auto（内容撑开，minWidth: 120px）
- 高度: 与当前 ToolButton 一致（~30px）
- 未配置的工具在列表中显示红点，点击后走现有逻辑（安装/配置提示）

---

## 3. 数据模型设计

### 3.1 自定义端点存储位置

**决策: 存在 Zustand store，持久化到 `~/.ai-terminal-manager.json`**

理由：
- 自定义端点是用户配置数据，不是代码。与现有 `providerConfigs` 同级存储最自然。
- 无需修改 Main 进程的 `PROVIDER_CATALOG`（那是硬编码的默认值），自定义端点作为运行时追加。
- 渲染进程已经有完整的 CRUD 权限。

### 3.2 数据结构

#### store 新增字段

```javascript
// Zustand store (sessions.js)
customProviders: {
  // key: 用户自定义的 provider ID (格式: custom-<timestamp>-<random>)
  // value: 同内建 provider 结构
  'custom-1713400000-a3f2k': {
    id: 'custom-1713400000-a3f2k',
    name: 'My DeepSeek',          // 用户自定义名称
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: 'sk-...',              // 存 Keychain，JSON 里是 '***'
    opusModel: 'deepseek-chat',
    sonnetModel: 'deepseek-chat',
    haikuModel: 'deepseek-chat',
    color: '#6366f1',              // 用户选的品牌色 (HEX)
    // baseTool 固定为 'claude'，不需要存
  }
}
```

#### 持久化到 config JSON

```javascript
// ~/.ai-terminal-manager.json
{
  ...existingFields,
  "customProviders": {
    "custom-1713400000-a3f2k": {
      "id": "custom-1713400000-a3f2k",
      "name": "My DeepSeek",
      "baseUrl": "https://api.deepseek.com/anthropic",
      "apiKey": "***",                     // Keychain 存真实值
      "opusModel": "deepseek-chat",
      "sonnetModel": "deepseek-chat",
      "haikuModel": "deepseek-chat",
      "color": "#6366f1"
    }
  }
}
```

### 3.3 颜色存储格式

**HEX 字符串** (`#6366f1`)，与现有 `toolVisuals.js` 中的格式一致。Glow 色在渲染时动态计算 (`rgba(r,g,b,0.35)`)。

### 3.4 预设色板

```
#d97706  琥珀 (Claude 默认)
#16a34a  绿色
#3b82f6  蓝色
#ef4444  红色
#a855f7  紫色
#06b6d4  青色
#ec4899  粉色
#f97316  橙色
#6366f1  靛蓝
#0d9488  蓝绿
#eab308  黄色
#64748b  灰色
```

12 色够用。自定义端点创建时随机分配一个未被占用的颜色。

### 3.5 与现有 PROVIDER_CATALOG 的关系

不修改 `PROVIDER_CATALOG`。合并策略：

```
最终可用 Provider 列表 = 内建 PROVIDER_CATALOG + store.customProviders
```

`getEffectiveProvider()` 需要扩展，同时查找内建和自定义。`buildLaunchCommand()` 无需修改 -- 它只看 `baseTool === 'claude'` + env vars，自定义 Provider 与内建 Provider 共享完全相同的启动逻辑。

---

## 4. 候选方案比较

### 候选 A: 纯下拉选择器（推荐）

- 选择器主体只显示当前工具
- 下拉列表包含所有工具（Anthropic 端点组 + 独立工具组）
- 自定义端点在列表底部有「添加」入口

**优点**: 工具栏宽度固定 (~140px)，不再随工具数量增长；分组清晰；可无限扩展。

**缺点**: 多一次点击（点击展开 + 点击选择 = 2 步 vs 当前 1 步）。但当前 9 个按钮已经溢出，属于不得不改。

### 候选 B: 分段选择器 + 最近使用

- Anthropic 端点用下拉选择器（因为数量多 + 可自定义）
- Codex / Gemini 保持独立按钮（只有 2 个）

**优点**: 高频工具（Codex/Gemini）保持 1 步直达。

**缺点**: 独立工具数量未来可能增长（Cursor? Copilot CLI?），又会回到平铺问题；两套交互增加理解成本。

### 候选 C: 命令面板式搜索

- 只有一个按钮，点击弹出全屏搜索框（类似 Cmd+P）
- 输入模糊匹配所有工具

**优点**: 极致紧凑，工具再多也不怕。

**缺点**: 交互重，不适合「选工具启动」这种高频操作；与现有 Cmd+P 命令面板功能重叠。

### 决策: 候选 A

理由：工具选择是高频操作，下拉选择器是最轻量的分组展示方式。2 步点击 vs 1 步点击的代价，换来的是无限扩展性和工具栏空间释放。

---

## 5. 文件级改动清单

### 5.1 新建文件

| 文件 | 职责 |
|------|------|
| `src/components/ToolSelector.jsx` | 下拉选择器组件（主体按钮 + 下拉列表 + 分组 + 自定义入口） |
| `src/components/settings/CustomProviderCard.jsx` | 自定义端点配置卡片（名称 + baseUrl + apiKey + 模型 + 颜色选择器） |

### 5.2 修改文件

| 文件 | 改动 |
|------|------|
| `src/constants/toolVisuals.js` | 1. 新增 `PRESET_COLORS` 色板常量<br>2. 新增 `getVisualForCustomProvider(customProvider)` 工具函数<br>3. 删除 `TOOL_ORDER` / `PROVIDER_ORDER`（由 ToolSelector 内部决定分组顺序） |
| `src/store/sessions.js` | 1. 新增 `customProviders` 字段<br>2. `init()` 从 config 加载 customProviders<br>3. `persist()` 写入 customProviders<br>4. 新增 `addCustomProvider(name, baseUrl, apiKey, color)`<br>5. 新增 `updateCustomProvider(id, patch)`<br>6. 新增 `removeCustomProvider(id)`<br>7. 扩展 `getEffectiveProvider(id)` 同时查找内建和自定义<br>8. 新增 `getAllProviders()` 合并内建 + 自定义列表 |
| `src/components/TerminalView.jsx` | 1. 删除 `toolbarLeft` 中的 `TOOL_ORDER.map()` + `PROVIDER_ORDER.map()` + `toolGroupDivider`<br>2. 替换为 `<ToolSelector />` 组件<br>3. 将 `handleLaunchTool` / `handleLaunchProvider` 提取为 props 或通过 store 方法暴露给 ToolSelector |
| `src/components/SettingsModal.jsx` | 1. Provider tab 底部追加「添加自定义端点」按钮<br>2. 渲染 `CustomProviderCard` 列表 |
| `src/components/settings/CustomProviderCard.jsx` | 颜色选择器用 12 色色板 + 选中态 |
| `src/components/ToolIcons.jsx` | 新增 `CustomProviderIcon` 组件（通用首字母图标，颜色由外部传入）<br>更新 `ToolIcon` 函数支持自定义 provider ID |
| `electron/config.js` | 无需修改 -- customProviders 作为 JSON 的一部分自动持久化，apiKey 走 Keychain 已有逻辑 |

### 5.3 不修改的文件

| 文件 | 理由 |
|------|------|
| `electron/tools.js` | 内建 TOOL_CATALOG / PROVIDER_CATALOG 不动，自定义端点纯渲染层 |
| `electron/monitor.js` | `sessionLaunchedTool` 已经能处理任意 toolId，不受影响 |
| `electron/preload.js` | 无新增 IPC，自定义端点的数据走 `config:save` / `config:load` |
| `electron/pty.js` | 启动命令通过 `buildLaunchCommand` 生成，已支持 provider 逻辑 |

---

## 6. 详细设计

### 6.1 ToolSelector 组件

```
props:
  - sessionId        (string)     当前会话 ID
  - yoloMode         (boolean)    YOLO 模式
  - toolCatalog      (object)     内建工具目录
  - toolStatus       (object)     安装状态
  - providerConfigs  (object)     内建 provider 配置
  - customProviders  (object)     自定义 provider 列表
  - onLaunchTool     (fn)         启动原生工具回调
  - onLaunchProvider (fn)         启动 provider 回调
  - onOpenSettings   (fn)         打开设置回调

state:
  - open (boolean)      下拉是否展开
  - activeGroup (string) 当前高亮的分组 ('anthropic' | 'standalone')

行为:
  - 点击主体 toggle open
  - 点击外部 close (useEffect + document click listener)
  - Escape 关闭
  - 选择工具后 close + 触发 launch
```

**分组逻辑**:

```javascript
// Anthropic 端点组
const anthropicEndpoints = [
  // 内建 Anthropic 工具: claude (baseTool undefined)
  { id: 'claude', kind: 'tool', ...TOOL_CATALOG.claude },
  // 内建 Provider: glm, minimax, kimi, qwencp
  ...Object.values(PROVIDER_CATALOG).map(p => ({ id: p.id, kind: 'provider', ...p })),
  // 自定义 Provider
  ...Object.values(customProviders).map(p => ({
    id: p.id,
    kind: 'custom-provider',
    name: p.name,
    baseTool: 'claude',
  })),
];

// 独立工具组
const standaloneTools = [
  'codex', 'gemini'
].map(id => ({ id, kind: 'tool', ...TOOL_CATALOG[id] }));
```

**选择器主体显示逻辑**:

```javascript
// 显示当前会话最后使用的工具，如果没有则显示 "Claude Code" (默认)
const currentToolId = sessionLastTool || 'claude';
const currentVisual = getVisualForTool(currentToolId);
// 渲染: 品牌色圆点 + 工具名 + ▾ 下拉箭头
```

### 6.2 getVisualForTool 统一视觉查找

```javascript
// src/constants/toolVisuals.js 新增
function getVisualForTool(toolId, customProviders = {}) {
  // 1. 查内建 TOOL_VISUALS
  if (TOOL_VISUALS[toolId]) return TOOL_VISUALS[toolId];
  // 2. 查自定义 Provider
  const custom = customProviders[toolId];
  if (custom) {
    return {
      label: custom.name,
      color: custom.color,
      glow: hexToGlow(custom.color),
    };
  }
  // 3. 兜底
  return { label: toolId, color: '#64748b', glow: 'rgba(100,116,139,0.35)' };
}
```

### 6.3 自定义端点图标

自定义端点没有专属 SVG 图标，使用通用首字母图标：

```javascript
// src/components/ToolIcons.jsx 新增
export const CustomProviderIcon = ({ size = 14, color = 'currentColor', letter = '?' }) => (
  <svg {...baseProps(size)}>
    <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="1.6" />
    <text
      x="12" y="12"
      textAnchor="middle" dominantBaseline="central"
      fill={color}
      fontSize="12"
      fontWeight="600"
      fontFamily="system-ui"
    >
      {letter}
    </text>
  </svg>
);

// 更新 ToolIcon 函数
export function ToolIcon({ id, size = 14, color = 'currentColor' }) {
  const Icon = TOOL_ICONS[id];
  if (Icon) return <Icon size={size} color={color} />;
  // 兜底: 首字母图标
  const letter = (id || '?')[0].toUpperCase();
  return <CustomProviderIcon size={size} color={color} letter={letter} />;
}
```

### 6.4 Store 扩展 (sessions.js)

```javascript
// --- 新增 state ---
customProviders: {},

// --- init() 中加载 ---
customProviders: config.customProviders || {},

// --- persist() 中写入 ---
customProviders,

// --- 新增方法 ---

addCustomProvider: ({ name, baseUrl, apiKey, color, opusModel, sonnetModel, haikuModel }) => {
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  set((s) => ({
    customProviders: {
      ...s.customProviders,
      [id]: { id, name, baseUrl, apiKey, color, opusModel, sonnetModel, haikuModel },
    },
  }));
  get().persist();
  return id;
},

updateCustomProvider: (id, patch) => {
  set((s) => ({
    customProviders: {
      ...s.customProviders,
      [id]: { ...(s.customProviders[id] || {}), ...patch },
    },
  }));
  get().persist();
},

removeCustomProvider: (id) => {
  set((s) => {
    const { [id]: _, ...rest } = s.customProviders;
    return { customProviders: rest };
  });
  get().persist();
},

// --- 修改 getEffectiveProvider ---
getEffectiveProvider: (providerId) => {
  const { toolCatalog, providerConfigs, customProviders } = get();

  // 查内建 Provider
  const def = toolCatalog.providers?.[providerId];
  if (def) {
    const userCfg = providerConfigs[providerId] || {};
    return {
      ...def,
      config: {
        apiKey: userCfg.apiKey || '',
        baseUrl: userCfg.baseUrl || def.defaults.baseUrl,
        opusModel: userCfg.opusModel || def.defaults.opusModel,
        sonnetModel: userCfg.sonnetModel || def.defaults.sonnetModel,
        haikuModel: userCfg.haikuModel || def.defaults.haikuModel,
      },
    };
  }

  // 查自定义 Provider
  const custom = customProviders[providerId];
  if (custom) {
    return {
      id: custom.id,
      name: custom.name,
      baseTool: 'claude',
      configurable: true,
      config: {
        apiKey: custom.apiKey || '',
        baseUrl: custom.baseUrl,
        opusModel: custom.opusModel,
        sonnetModel: custom.sonnetModel,
        haikuModel: custom.haikuModel,
      },
    };
  }

  return null;
},
```

### 6.5 Keychain 集成

`config.js` 的 `extractAndStoreKeys` / `restoreKeysIntoConfig` 已经通用处理 `providerConfigs` 中的 apiKey。需要新增对 `customProviders` 的同等处理：

```javascript
// electron/config.js - saveConfigAsync
async function saveConfigAsync(data) {
  const toWrite = JSON.parse(JSON.stringify(data));

  // 现有: 提取内建 provider 的 apiKey 到 Keychain
  if (toWrite.providerConfigs) {
    toWrite.providerConfigs = await extractAndStoreKeys(toWrite.providerConfigs);
  }

  // 新增: 提取自定义 provider 的 apiKey 到 Keychain
  if (toWrite.customProviders) {
    toWrite.customProviders = await extractAndStoreKeys(toWrite.customProviders);
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(toWrite, null, 2), 'utf-8');
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch (_) {}
  cachedConfig = JSON.parse(JSON.stringify(data));
}

// electron/config.js - loadConfigAsync
async function loadConfigAsync() {
  // ... existing load logic ...

  // 现有: 恢复内建 provider 的 apiKey
  if (config.providerConfigs) {
    config.providerConfigs = await restoreKeysIntoConfig(config.providerConfigs);
  }

  // 新增: 恢复自定义 provider 的 apiKey
  if (config.customProviders) {
    config.customProviders = await restoreKeysIntoConfig(config.customProviders);
  }

  cachedConfig = config;
  return config;
}
```

### 6.6 TerminalView.jsx 改动

**删除** (~L808-865): 整个 `toolbarLeft` 内的 `TOOL_ORDER.map()` + `toolGroupDivider` + `PROVIDER_ORDER.map()`

**替换为**:

```jsx
<div style={styles.toolbarLeft}>
  <ToolSelector
    sessionId={sessionId}
    yoloMode={yoloMode}
    toolCatalog={toolCatalog}
    toolStatus={toolStatus}
    providerConfigs={providerConfigs}
    customProviders={customProviders}
    sessionLastTool={sessionLastTool}
    onLaunchTool={handleLaunchTool}
    onLaunchProvider={handleLaunchProvider}
    onOpenSettings={openSettings}
  />
</div>
```

**新增 store 读取**:

```javascript
const customProviders = useSessionStore((s) => s.customProviders);
```

### 6.7 SettingsModal.jsx 改动

Provider tab 底部追加:

```jsx
{/* 自定义端点列表 */}
{Object.values(customProviders).map((cp) => (
  <CustomProviderCard
    key={cp.id}
    provider={cp}
    onUpdate={(patch) => updateCustomProvider(cp.id, patch)}
    onRemove={() => removeCustomProvider(cp.id)}
    color={cp.color}
  />
))}

{/* 添加按钮 */}
<button
  onClick={() => {
    const id = addCustomProvider({
      name: '新端点',
      baseUrl: '',
      apiKey: '',
      color: PRESET_COLORS[Object.keys(customProviders).length % PRESET_COLORS.length],
      opusModel: '',
      sonnetModel: '',
      haikuModel: '',
    });
    // 滚动到新卡片
  }}
  style={styles.addProviderBtn}
>
  + 添加 Anthropic 端点
</button>
```

### 6.8 颜色选择器 (CustomProviderCard 内)

```jsx
const PRESET_COLORS = [
  '#d97706', '#16a34a', '#3b82f6', '#ef4444',
  '#a855f7', '#06b6d4', '#ec4899', '#f97316',
  '#6366f1', '#0d9488', '#eab308', '#64748b',
];

function ColorPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            background: c,
            border: value === c ? '2px solid #fff' : '2px solid transparent',
            cursor: 'pointer',
          }}
        />
      ))}
    </div>
  );
}
```

---

## 7. 实施步骤（严格顺序）

### Phase 1: 数据层（无 UI 变动，不影响现有功能）

1. **`src/store/sessions.js`** -- 新增 `customProviders` 字段、init/persist、CRUD 方法、扩展 `getEffectiveProvider`
2. **`electron/config.js`** -- `saveConfigAsync` / `loadConfigAsync` 新增 `customProviders` 的 Keychain 处理
3. **`src/constants/toolVisuals.js`** -- 新增 `PRESET_COLORS`、`getVisualForTool()` 函数、`hexToGlow()` 辅助函数

### Phase 2: 图标层（无 UI 变动）

4. **`src/components/ToolIcons.jsx`** -- 新增 `CustomProviderIcon` 组件，更新 `ToolIcon` 函数兜底逻辑

### Phase 3: 新组件（不替换现有 UI）

5. **`src/components/ToolSelector.jsx`** -- 新建下拉选择器组件
6. **`src/components/settings/CustomProviderCard.jsx`** -- 新建自定义端点配置卡片

### Phase 4: 集成替换（核心改动，一次性切换）

7. **`src/components/TerminalView.jsx`** -- 替换 `toolbarLeft` 内容为 `<ToolSelector />`
8. **`src/components/SettingsModal.jsx`** -- Provider tab 追加自定义端点管理

### Phase 5: 清理

9. **`src/constants/toolVisuals.js`** -- 删除 `TOOL_ORDER` / `PROVIDER_ORDER`（确认无其他引用后）
10. **`src/components/TerminalView.jsx`** -- 删除未使用的 `hoveredTool` state、`ToolButton` 组件、`toolBtnStyles`

---

## 8. 开发边界

### In-scope（本次必做）

1. 新建 `ToolSelector.jsx` 下拉选择器组件（分组 + 选择 + 展开/收起）
2. 新建 `CustomProviderCard.jsx`（名称 + baseUrl + apiKey + 模型 + 颜色）
3. Store 新增 `customProviders` 及 CRUD
4. Config 持久化支持 `customProviders`（含 Keychain）
5. `toolVisuals.js` 新增 `PRESET_COLORS` + `getVisualForTool()`
6. `ToolIcons.jsx` 新增自定义端点图标
7. `TerminalView.jsx` 工具栏替换
8. `SettingsModal.jsx` Provider tab 追加自定义端点管理
9. `electron/config.js` Keychain 对 customProviders 的处理

### Out-of-scope（本次明确不做）

1. **工具安装状态显示优化** -- 下拉列表中未安装工具的红点提示样式调整，属于视觉微调，后续单独处理
2. **拖拽排序** -- 自定义端点的列表排序，用户通过创建顺序即可，不做拖拽
3. **自定义端点图标上传** -- 使用首字母图标，不支持自定义 SVG
4. **快捷键启动** -- Cmd+1~9 已经可以通过命令面板触发，不做下拉选择器的快捷键
5. **内建 Provider 颜色自定义** -- 只允许自定义端点改颜色，内建 Provider 保持硬编码
6. **Sidebar 中的工具选择** -- Sidebar 的会话右键菜单中已有「启动工具」子菜单，本次不动
7. **自定义独立工具** -- 只支持自定义 Anthropic 格式端点，不支持自定义独立的二进制工具（如自定义 Copilot CLI）

### 边界依据

- 业务边界: 用户需求明确是"Anthropic 格式端点"的自定义，不涉及新二进制
- 技术边界: 自定义二进制需要动态 PATH 探测、版本检查、安装命令，复杂度远超本次范围
- 成本边界: 本次改动 ~6 个文件修改 + 2 个新建，控制在 1-2 天内

### 违反边界的后果

开发若越界（如试图支持自定义二进制工具、或给内建 Provider 加颜色自定义），必须通过 BLOCKED 回归方案复核，不得静默扩大范围。

---

## 9. 主要风险点

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Keychain extractAndStoreKeys 对 customProviders 格式不兼容 | apiKey 持久化失败 | extractAndStoreKeys 只看 `apiKey` 字段，customProviders 结构兼容。写测试验证 |
| 下拉选择器在 split pane 模式下溢出 | 遮挡另一个 pane | ToolSelector 使用 Portal 渲染下拉列表到 document.body，脱离 split 容器 |
| 删除 TOOL_ORDER/PROVIDER_ORDER 后其他组件引用报错 | 编译失败 | 先 grep 全局搜索确认无其他消费者，Phase 5 清理 |
| 自定义端点 ID 与内建 Provider ID 冲突 | getEffectiveProvider 返回错误 | 自定义 ID 使用 `custom-` 前缀，内建 ID 无此前缀，天然隔离 |
| 下拉选择器展开时点击终端区域不收起 | UX 问题 | document.addEventListener('mousedown', ...) 处理外部点击关闭 |

---

## 10. DoD（Definition of Done）

1. **功能验证**: 工具栏左侧显示下拉选择器，点击展开包含 "Anthropic 端点" 和 "独立工具" 两个分组，选择后能正确启动对应工具
2. **自定义端点**: 在设置中添加自定义 Anthropic 端点后，下拉列表中能显示该端点，选择后能正确注入 ANTHROPIC_BASE_URL 等环境变量启动
3. **颜色自定义**: 自定义端点能从 12 色色板中选择颜色，选择器中显示该颜色
4. **持久化**: 退出重启后，自定义端点配置（含 Keychain 中的 apiKey）完整恢复
5. **兼容性**: 现有内建 Provider (GLM/MiniMax/Kimi/QwenCP) 的功能不受影响
6. **回归**: monitor.js 进程监控、autoRestore 自动恢复、通知系统正常工作

---

## 11. 需要升级的判断

- **architect**: 不需要 -- 不涉及跨进程架构变更，不新增基础设施
- **database**: 不需要 -- 无数据库，JSON 文件持久化
- **visual-designer**: 不需要 -- 使用现有设计语言（暗色、圆角、品牌色），颜色选择器是标准化组件
