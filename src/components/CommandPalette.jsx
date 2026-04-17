/**
 * CommandPalette.jsx — Cmd+P quick-launch palette.
 *
 * Sections:
 *   • Sessions    — all sessions across all projects; click to activate
 *   • Actions     — panel toggles, settings, broadcast, etc.
 *
 * Keyboard:
 *   Cmd+P        — toggle open/close (handled in App.jsx)
 *   Esc          — close
 *   ↑ / ↓        — navigate items
 *   Enter        — select highlighted item
 */

import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { useSessionStore } from '../store/sessions';
import { TOOL_LABELS } from '../constants/toolVisuals';

// ─── Score a query against a label (simple substring match + rank) ────────────

function fuzzyScore(query, label) {
  const q = query.toLowerCase();
  const l = label.toLowerCase();
  if (!q) return 1;
  if (l === q) return 3;
  if (l.startsWith(q)) return 2;
  if (l.includes(q)) return 1;
  return 0;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CommandPalette() {
  const commandPaletteOpen    = useSessionStore((s) => s.commandPaletteOpen);
  const closeCommandPalette   = useSessionStore((s) => s.closeCommandPalette);
  const projects              = useSessionStore((s) => s.projects);
  const sessionStatus         = useSessionStore((s) => s.sessionStatus);
  const activeSessionId       = useSessionStore((s) => s.activeSessionId);
  const setActiveSession      = useSessionStore((s) => s.setActiveSession);
  const openSettings          = useSessionStore((s) => s.openSettings);
  const toggleFileTree        = useSessionStore((s) => s.toggleFileTree);
  const toggleGitPanel        = useSessionStore((s) => s.toggleGitPanel);
  const toggleTodoPanel       = useSessionStore((s) => s.toggleTodoPanel);
  const toggleBroadcastMode   = useSessionStore((s) => s.toggleBroadcastMode);
  const broadcastMode         = useSessionStore((s) => s.broadcastMode);
  const toggleYoloMode        = useSessionStore((s) => s.toggleYoloMode);
  const yoloMode              = useSessionStore((s) => s.yoloMode);
  const addSessionToActiveProject = useSessionStore((s) => s.addSessionToActiveProject);

  const [query, setQuery]   = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef   = useRef(null);
  const listRef    = useRef(null);

  // Reset state when opened
  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [commandPaletteOpen]);

  // ── Build item list ─────────────────────────────────────────────────────────

  const items = useMemo(() => {
    const result = [];

    // Session items
    for (const p of projects) {
      for (const s of p.sessions) {
        const status = sessionStatus[s.id];
        const toolLabel = status?.tool ? (TOOL_LABELS?.[status.tool] || status.tool) : null;
        const isActive  = s.id === activeSessionId;
        result.push({
          type: 'session',
          id: `session-${s.id}`,
          label: `${p.name} / ${s.name}`,
          hint: toolLabel || (isActive ? '当前' : ''),
          isActive,
          action: () => {
            setActiveSession(s.id);
            closeCommandPalette();
          },
        });
      }
    }

    // Action items
    const actions = [
      {
        id: 'action-new-session',
        label: '新建会话',
        hint: 'Cmd+T',
        action: () => { addSessionToActiveProject(); closeCommandPalette(); },
      },
      {
        id: 'action-settings',
        label: '打开设置',
        hint: '⚙',
        action: () => { openSettings(); closeCommandPalette(); },
      },
      {
        id: 'action-file-tree',
        label: '切换文件树',
        hint: '文件浏览',
        action: () => { toggleFileTree(); closeCommandPalette(); },
      },
      {
        id: 'action-git',
        label: '切换 Git 面板',
        hint: 'Git',
        action: () => { toggleGitPanel(); closeCommandPalette(); },
      },
      {
        id: 'action-todo',
        label: '切换待办面板',
        hint: 'Cmd+Shift+T',
        action: () => { toggleTodoPanel(); closeCommandPalette(); },
      },
      {
        id: 'action-broadcast',
        label: broadcastMode ? '关闭广播模式' : '开启广播模式',
        hint: '多终端同步输入',
        action: () => { toggleBroadcastMode(); closeCommandPalette(); },
      },
      {
        id: 'action-yolo',
        label: yoloMode ? '关闭 YOLO 模式' : '开启 YOLO 模式',
        hint: '跳过确认提示',
        action: () => { toggleYoloMode(); closeCommandPalette(); },
      },
    ];

    for (const a of actions) {
      result.push({ type: 'action', ...a });
    }

    return result;
  }, [
    projects, sessionStatus, activeSessionId,
    broadcastMode, yoloMode,
    setActiveSession, closeCommandPalette,
    openSettings, toggleFileTree, toggleGitPanel, toggleTodoPanel,
    toggleBroadcastMode, toggleYoloMode, addSessionToActiveProject,
  ]);

  // ── Filter items by query ───────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    return items
      .map((item) => ({ item, score: fuzzyScore(query, item.label) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
  }, [items, query]);

  // Clamp selection when filtered list changes
  useEffect(() => {
    setSelected((prev) => Math.min(prev, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // ── Keyboard navigation ─────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCommandPalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selected]) filtered[selected].action();
    }
  }, [closeCommandPalette, filtered, selected]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selected];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!commandPaletteOpen) return null;

  return createPortal(
    <div style={styles.overlay} onMouseDown={(e) => {
      if (e.target === e.currentTarget) closeCommandPalette();
    }}>
      <div style={styles.panel}>
        {/* Search input */}
        <div style={styles.inputWrap}>
          <span style={styles.searchIcon}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleKeyDown}
            placeholder="搜索会话或操作..."
            style={styles.input}
          />
          {query && (
            <button onClick={() => setQuery('')} style={styles.clearInput}>×</button>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} style={styles.list}>
          {filtered.length === 0 ? (
            <div style={styles.empty}>没有匹配的结果</div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                style={{
                  ...styles.item,
                  background: i === selected ? '#1d2d44' : 'transparent',
                  borderLeft: item.isActive
                    ? '2px solid #f59e0b'
                    : i === selected
                      ? '2px solid #3b82f6'
                      : '2px solid transparent',
                }}
                onMouseEnter={() => setSelected(i)}
                onClick={item.action}
              >
                <span style={styles.itemIcon}>
                  {item.type === 'session' ? '▪' : '↳'}
                </span>
                <span style={styles.itemLabel}>{item.label}</span>
                {item.hint && (
                  <span style={styles.itemHint}>{item.hint}</span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div style={styles.footer}>
          <span>↑↓ 导航</span>
          <span>Enter 选择</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    zIndex: 9000,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '15vh',
  },
  panel: {
    width: 540,
    maxWidth: 'calc(100vw - 48px)',
    background: '#111',
    border: '1px solid #2a2a2a',
    borderRadius: 10,
    boxShadow: '0 24px 64px rgba(0,0,0,0.8)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'system-ui, -apple-system',
  },
  inputWrap: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    borderBottom: '1px solid #1e1e1e',
    height: 48,
    gap: 8,
  },
  searchIcon: {
    fontSize: 18,
    color: '#444',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#e0e0e0',
    fontSize: 14,
    fontFamily: 'system-ui, -apple-system',
  },
  clearInput: {
    background: 'transparent',
    border: 'none',
    color: '#555',
    fontSize: 16,
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1,
  },
  list: {
    maxHeight: 360,
    overflowY: 'auto',
    padding: '4px 0',
  },
  item: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.1s',
    fontFamily: 'system-ui, -apple-system',
  },
  itemIcon: {
    fontSize: 10,
    color: '#555',
    flexShrink: 0,
    width: 12,
  },
  itemLabel: {
    flex: 1,
    fontSize: 13,
    color: '#d0d0d0',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemHint: {
    fontSize: 11,
    color: '#4a4a4a',
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  empty: {
    padding: '24px 0',
    textAlign: 'center',
    color: '#333',
    fontSize: 13,
  },
  footer: {
    borderTop: '1px solid #1a1a1a',
    display: 'flex',
    gap: 16,
    padding: '6px 14px',
    fontSize: 10.5,
    color: '#333',
    fontFamily: 'system-ui, -apple-system',
  },
};
