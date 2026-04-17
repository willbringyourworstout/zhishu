import React from 'react';
import styles from './styles';

/**
 * Single tool row showing install status and install/upgrade actions.
 */
export default function ToolRow({ tool, status, sessionId, color }) {
  const installed = status?.installed;
  const version = status?.version;

  const handleInstall = () => {
    if (!sessionId) {
      alert('请先在左侧打开一个会话');
      return;
    }
    window.electronAPI.installToolInSession(sessionId, tool.id, 'install');
  };

  const handleUpgrade = () => {
    if (!sessionId) {
      alert('请先在左侧打开一个会话');
      return;
    }
    window.electronAPI.installToolInSession(sessionId, tool.id, 'upgrade');
  };

  return (
    <div style={styles.toolRow}>
      <div style={{ ...styles.toolBadge, background: `${color}15`, borderColor: `${color}40`, color }}>
        {tool.command[0].toUpperCase()}
      </div>
      <div style={styles.toolInfo}>
        <div style={styles.toolName}>{tool.name}</div>
        <div style={styles.toolMeta}>
          <code style={styles.toolCmd}>{tool.command}</code>
          <span style={{ ...styles.toolBadgeSmall, color: installed ? '#22c55e' : '#555' }}>
            {installed === undefined ? '检测中…' : installed ? `✓ ${version || 'installed'}` : '未安装'}
          </span>
        </div>
      </div>
      <div style={styles.toolActions}>
        {installed ? (
          <button style={styles.btnSecondary} onClick={handleUpgrade}>升级</button>
        ) : (
          <button style={{ ...styles.btnPrimary, borderColor: color, color }} onClick={handleInstall}>
            安装
          </button>
        )}
      </div>
    </div>
  );
}
