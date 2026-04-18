# src/components/sidebar/ — 侧边栏子组件

从 Sidebar.jsx 拆分出的子组件，负责项目卡片和会话行的渲染与交互。

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `ProjectSection.jsx` | 246 | 项目卡片：折叠/拖拽排序/内联重命名/TODO 徽章/操作按钮 |
| `SessionRow.jsx` | 249 | 会话行：拖拽排序/阶段指示器/内联重命名/抓手 |
| `styles.js` | 491 | 共享 CSS-in-JS 样式（Sidebar + ProjectSection + SessionRow） |
| `icons.js` | 88 | 内联 SVG 图标（IconFolder, IconTerminal, IconGrip 等） |
| `helpers.js` | 49 | `getPhaseIndicator(status, customProviders)` 四阶段视觉映射 + `fmtDuration` |
| `EditableLabel.jsx` | 44 | 双击内联编辑标签（React.memo） |

## 组件关系

```
Sidebar.jsx
  └── ProjectSection.jsx (per project, React.memo)
        ├── EditableLabel.jsx (项目名内联编辑)
        └── SessionRow.jsx (per session, React.memo)
              ├── icons.js (IconTerminal, IconGrip)
              └── helpers.js (getPhaseIndicator)
```

## 关键逻辑

- **阶段指示器** (`getPhaseIndicator`): 根据 sessionStatus 返回 {color, animation, title}，4 种状态对应不同视觉效果
- **拖拽排序**: 通过 HTML5 Drag API + `application/x-prism-project` / `application/x-prism-session` MIME 类型
- **数据来源**: ProjectSection 直接调用 store actions（addSession, removeSession, reorderSessions 等）；SessionRow 通过 props 接收数据
