import React from 'react';
import styles from './styles';

/**
 * Appearance settings tab — theme selection + auto-restore toggle.
 * ThemeCard is inlined here since it's a private sub-component.
 */
export default function AppearanceTab({ theme, setTheme, autoRestoreSessions, toggleAutoRestoreSessions }) {
  return (
    <div>
      <p style={styles.hint}>选择界面主题。深色主题更适合长时间使用。</p>
      <div style={styles.themeRow}>
        <ThemeCard
          id="dark"
          label="深色"
          active={theme === 'dark'}
          onClick={() => setTheme('dark')}
          colors={['#0a0a0a', '#0d0d0d', '#f59e0b']}
        />
        <ThemeCard
          id="light"
          label="浅色"
          active={theme === 'light'}
          onClick={() => setTheme('light')}
          colors={['#f8fafc', '#ffffff', '#d97706']}
        />
      </div>
      <p style={styles.hintDim}>
        浅色主题已支持基础界面（侧边栏、工具栏、状态栏）。部分组件仍有硬编码颜色，将在后续版本逐步迁移。
      </p>

      {/* Section divider */}
      <div style={{ height: 1, background: '#1a1a1a', margin: '24px 0 18px' }} />

      {/* Auto-restore sessions toggle */}
      <div style={styles.toggleRow}>
        <div style={styles.toggleInfo}>
          <div style={styles.toggleLabel}>启动时自动恢复 AI 会话</div>
          <div style={styles.toggleDesc}>
            应用重启时，对每个曾运行过 AI 工具的会话自动执行该工具的"续接最近一次会话"命令
            （如 <code style={styles.codeMark}>claude --continue</code> /
            <code style={styles.codeMark}>codex resume --last</code>），
            恢复完整的 AI 上下文。
          </div>
        </div>
        <button
          onClick={toggleAutoRestoreSessions}
          style={{
            ...styles.switch,
            background: autoRestoreSessions ? '#1a150a' : '#151515',
            borderColor: autoRestoreSessions ? '#3a2e0a' : '#2a2a2a',
          }}
        >
          <div style={{
            ...styles.switchKnob,
            transform: autoRestoreSessions ? 'translateX(18px)' : 'translateX(0)',
            background: autoRestoreSessions ? '#f59e0b' : '#444',
          }} />
        </button>
      </div>
    </div>
  );
}

// ─── Private sub-component ──────────────────────────────────────────────────

function ThemeCard({ id, label, active, onClick, colors, wip, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles.themeCard,
        borderColor: active ? '#f59e0b' : '#1e1e1e',
        boxShadow: active ? '0 0 0 1px rgba(245, 158, 11, 0.3), 0 4px 16px rgba(245, 158, 11, 0.15)' : 'none',
        position: 'relative',
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <div style={styles.themePreview}>
        <div style={{ ...styles.themePreviewSidebar, background: colors[1] }} />
        <div style={{ ...styles.themePreviewMain, background: colors[0] }}>
          <div style={{ ...styles.themePreviewBar, background: colors[2] }} />
        </div>
      </div>
      <div style={{ ...styles.themeLabel, color: active ? '#e2e8f0' : '#888' }}>
        {label}
      </div>
      {wip && (
        <span style={styles.wipBadge}>开发中</span>
      )}
    </button>
  );
}
