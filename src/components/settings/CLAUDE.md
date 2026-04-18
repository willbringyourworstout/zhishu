# src/components/settings/ — 设置子组件

从 SettingsModal.jsx 拆分出的子组件，负责 5 个设置 tab 的渲染与交互。

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `styles.js` | 470 | 共享 CSS-in-JS 样式（所有 settings 子组件） |
| `CustomProviderCard.jsx` | 172 | 自定义 Anthropic 端点：name/apiKey/baseUrl/model + 12 色调色板 |
| `AgentConfigTab.jsx` | 115 | Agent 记忆文件管理：检测/创建/打开/定位 |
| `AppearanceTab.jsx` | 95 | 主题选择（dark/light ThemeCard）+ 自动恢复开关 |
| `ProviderCard.jsx` | 96 | 内置 Provider：apiKey 显隐/baseUrl/model overrides |
| `ToolRow.jsx` | 52 | 工具安装状态：badge/command/version/install |
| `TabButton.jsx` | 21 | Tab 按钮（amber 激活指示器） |
| `Field.jsx` | 14 | 通用表单字段包装（label + children） |

## 组件关系

```
SettingsModal.jsx (5 tabs)
  ├── "AI Tools" → ToolRow.jsx
  ├── "Provider" → ProviderCard.jsx + CustomProviderCard.jsx
  ├── "Agent Config" → AgentConfigTab.jsx
  ├── "Appearance" → AppearanceTab.jsx
  └── "About"
  └── TabButton.jsx (所有 tab 共用)
  └── Field.jsx (ProviderCard + CustomProviderCard 共用)
```

## 关键逻辑

- **CustomProviderCard**: 12 色预设调色板（ColorPicker），支持自定义 name/apiKey/baseUrl/model
- **AgentConfigTab**: 通过 IPC 检测 `~/.claude/` 下各工具的 CLAUDE.md 记忆文件
- **数据流**: SettingsModal 直接调用 store actions（updateProviderConfig, addCustomProvider 等），子组件通过 onUpdate 回调通知父组件
