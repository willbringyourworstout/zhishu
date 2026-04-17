import React, { useState, useEffect } from 'react';
import styles from './styles';

/**
 * Agent Config Tab — shows per-tool memory files for the active project.
 * AgentFileRow is inlined here since it's a private sub-component.
 */
export default function AgentConfigTab({ project, tools }) {
  if (!project) {
    return (
      <div style={styles.hint}>
        请先在左侧选择一个项目和会话。
      </div>
    );
  }

  return (
    <div>
      <p style={styles.hint}>
        每个 AI 工具都有自己的项目级配置文件（Memory File），AI 会自动读取它来理解你的项目。
        Codex 和 OpenCode 共用 <code style={styles.codeMark}>AGENTS.md</code>。
      </p>
      <div style={styles.agentList}>
        {tools.map((tool) => (
          <AgentFileRow key={tool.id} tool={tool} projectPath={project.path} />
        ))}
      </div>
    </div>
  );
}

// ─── Private sub-component ──────────────────────────────────────────────────

function AgentFileRow({ tool, projectPath }) {
  const [exists, setExists] = useState(null);
  const filePath = `${projectPath}/${tool.memoryFile || 'AGENTS.md'}`;

  useEffect(() => {
    window.electronAPI.fileExists(filePath).then(setExists);
  }, [filePath]);

  const handleCreate = async () => {
    const template = generateMemoryTemplate(tool, projectPath);
    const res = await window.electronAPI.writeFile(filePath, template);
    if (res?.ok) {
      setExists(true);
      window.electronAPI.openFile(filePath);
    } else {
      alert(`创建失败: ${res?.error}`);
    }
  };

  const handleOpen = () => window.electronAPI.openFile(filePath);
  const handleReveal = () => window.electronAPI.revealInFinder(filePath);

  return (
    <div style={styles.agentRow}>
      <div style={styles.agentRowLeft}>
        <div style={styles.agentName}>{tool.name}</div>
        <code style={styles.agentPath}>{tool.memoryFile || 'AGENTS.md'}</code>
      </div>
      <div style={styles.agentRowRight}>
        {exists === null && <span style={styles.agentDim}>检测中…</span>}
        {exists === false && (
          <button style={styles.btnSmall} onClick={handleCreate}>+ 创建</button>
        )}
        {exists === true && (
          <>
            <span style={styles.agentExists}>✓ 已存在</span>
            <button style={styles.btnSmall} onClick={handleOpen}>打开</button>
            <button style={styles.btnSmallSec} onClick={handleReveal}>定位</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function generateMemoryTemplate(tool, projectPath) {
  const projectName = projectPath.split('/').pop() || 'Project';
  return `# ${projectName}

> ${tool.name} 项目级 Memory 文件

## 项目背景

<!-- 简要描述这个项目是做什么的 -->

## 技术栈

<!-- 列出主要技术、框架、依赖 -->

## 代码风格约定

<!-- 命名规范、文件组织、注释风格等 -->

## 重要的文件 / 模块

<!-- 列出关键文件位置和用途 -->

## 常用命令

\`\`\`bash
# 启动开发
# 运行测试
# 构建
\`\`\`

## 已知约束 / 注意事项

<!-- 例如：不要提交某些文件，某些 API 有限流，等等 -->
`;
}
