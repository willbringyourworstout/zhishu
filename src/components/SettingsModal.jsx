import React, { useState, useEffect } from 'react';
import { useSessionStore } from '../store/sessions';
import { TOOL_COLORS } from '../constants/toolVisuals';
import styles from './settings/styles';
import TabButton from './settings/TabButton';
import ToolRow from './settings/ToolRow';
import ProviderCard from './settings/ProviderCard';
import AgentConfigTab from './settings/AgentConfigTab';
import AppearanceTab from './settings/AppearanceTab';
import { version } from '../../package.json';

/**
 * Modal overlay for configuring providers + viewing tool installation status.
 * Accessible via the gear button in the top toolbar.
 *
 * Sub-components live in ./settings/:
 *   TabButton, ToolRow, ProviderCard, Field, AgentConfigTab, AppearanceTab
 * Shared styles in ./settings/styles.js
 */
export default function SettingsModal() {
  const {
    settingsOpen, closeSettings,
    toolCatalog, toolStatus, refreshToolStatus,
    providerConfigs, updateProviderConfig,
    activeSessionId,
    theme, setTheme,
    getActiveSession,
    autoRestoreSessions, toggleAutoRestoreSessions,
  } = useSessionStore();

  const [activeTab, setActiveTab] = useState('tools');
  const activeProject = getActiveSession()?.project;

  // Refresh tool status when the modal opens
  useEffect(() => {
    if (settingsOpen) refreshToolStatus();
  }, [settingsOpen, refreshToolStatus]);

  // Dismiss on Escape
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e) => { if (e.key === 'Escape') closeSettings(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settingsOpen, closeSettings]);

  if (!settingsOpen) return null;

  const tools = Object.values(toolCatalog.tools || {});
  const providers = Object.values(toolCatalog.providers || {});

  return (
    <div style={styles.backdrop} onClick={closeSettings}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.headerIcon}>⚙</span>
            <span style={styles.headerTitle}>设置</span>
          </div>
          <button style={styles.closeBtn} onClick={closeSettings} title="关闭 (Esc)">×</button>
        </div>

        {/* Tabs */}
        <div style={styles.tabs}>
          <TabButton active={activeTab === 'tools'} onClick={() => setActiveTab('tools')}>
            AI 工具
          </TabButton>
          <TabButton active={activeTab === 'providers'} onClick={() => setActiveTab('providers')}>
            Provider
          </TabButton>
          <TabButton active={activeTab === 'agents'} onClick={() => setActiveTab('agents')}>
            Agent 配置
          </TabButton>
          <TabButton active={activeTab === 'appearance'} onClick={() => setActiveTab('appearance')}>
            外观
          </TabButton>
          <TabButton active={activeTab === 'about'} onClick={() => setActiveTab('about')}>
            关于
          </TabButton>
          <div style={{ flex: 1 }} />
          {activeTab === 'tools' && (
            <button style={styles.refreshBtn} onClick={refreshToolStatus} title="重新检测">
              ↻ 检测
            </button>
          )}
        </div>

        {/* Body */}
        <div style={styles.body}>
          {activeTab === 'tools' && (
            <div style={styles.toolsList}>
              {tools.map((tool) => (
                <ToolRow
                  key={tool.id}
                  tool={tool}
                  status={toolStatus[tool.id]}
                  sessionId={activeSessionId}
                  color={TOOL_COLORS[tool.id] || '#888'}
                />
              ))}
            </div>
          )}

          {activeTab === 'providers' && (
            <div style={styles.providersList}>
              <p style={styles.hint}>
                Provider 基于官方 Claude 二进制，通过环境变量切换 API 端点。
                配置后可直接一键启动，无需任何 shell 函数。
              </p>
              {providers.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  config={providerConfigs[provider.id] || {}}
                  onUpdate={(patch) => updateProviderConfig(provider.id, patch)}
                  color={TOOL_COLORS[provider.id] || '#888'}
                />
              ))}
            </div>
          )}

          {activeTab === 'agents' && (
            <AgentConfigTab project={activeProject} tools={tools} />
          )}

          {activeTab === 'appearance' && (
            <AppearanceTab
              theme={theme}
              setTheme={setTheme}
              autoRestoreSessions={autoRestoreSessions}
              toggleAutoRestoreSessions={toggleAutoRestoreSessions}
            />
          )}

          {activeTab === 'about' && (
            <div style={styles.aboutBox}>
              <h3 style={styles.aboutTitle}>智枢 ZhiShu</h3>
              <p style={styles.aboutText}>
                One interface. Every AI, in focus.
              </p>
              <p style={styles.aboutText}>
                支持 Claude / Codex / Gemini / Qwen / OpenCode / GLM / MiniMax / Kimi
                等多种工具的快捷启动、进程监控、响应完成通知、Git 管理和文件浏览。
              </p>
              <div style={styles.aboutMeta}>
                <div>version {version}</div>
                <div>Electron · React · xterm.js · node-pty</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
