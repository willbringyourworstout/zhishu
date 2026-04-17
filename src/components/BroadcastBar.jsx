/**
 * BroadcastBar.jsx — Multi-terminal broadcast input bar.
 *
 * When broadcastMode is active, an input bar appears at the bottom of the
 * terminal area. Text entered here is sent to ALL active pty sessions
 * simultaneously — useful for running the same command in multiple terminals.
 *
 * Mounts inside App.jsx within the termArea div.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSessionStore } from '../store/sessions';

export default function BroadcastBar() {
  const broadcastMode       = useSessionStore((s) => s.broadcastMode);
  const disableBroadcastMode = useSessionStore((s) => s.disableBroadcastMode);
  const projects            = useSessionStore((s) => s.projects);

  const [text, setText] = useState('');
  const inputRef = useRef(null);

  // Focus input whenever broadcast mode is activated
  useEffect(() => {
    if (broadcastMode) {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [broadcastMode]);

  const broadcast = useCallback((data) => {
    for (const p of projects) {
      for (const s of p.sessions) {
        window.electronAPI.writePty(s.id, data);
      }
    }
  }, [projects]);

  const handleSend = useCallback(() => {
    if (!text) return;
    broadcast(text + '\r');
    setText('');
    inputRef.current?.focus();
  }, [text, broadcast]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      disableBroadcastMode();
    }
    // Ctrl+C → send interrupt to all sessions
    if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault();
      broadcast('\x03');
    }
  }, [handleSend, disableBroadcastMode, broadcast]);

  const sessionCount = projects.reduce((n, p) => n + p.sessions.length, 0);

  if (!broadcastMode) return null;

  return (
    <div style={styles.root}>
      {/* Label */}
      <div style={styles.label}>
        <span style={styles.dot} />
        <span>广播</span>
        <span style={styles.count}>{sessionCount} 个会话</span>
      </div>

      {/* Input */}
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入命令，Enter 广播到所有终端 · Esc 退出广播模式"
        style={styles.input}
      />

      {/* Actions */}
      <div style={styles.actions}>
        <button
          onClick={handleSend}
          disabled={!text}
          style={{ ...styles.sendBtn, opacity: text ? 1 : 0.4, cursor: text ? 'pointer' : 'not-allowed' }}
          title="广播到所有终端"
        >
          广播
        </button>
        <button
          onClick={() => broadcast('\x03')}
          style={styles.ctrlcBtn}
          title="向所有终端发送 Ctrl+C"
        >
          Ctrl+C
        </button>
        <button
          onClick={disableBroadcastMode}
          style={styles.closeBtn}
          title="退出广播模式 (Esc)"
        >
          ×
        </button>
      </div>
    </div>
  );
}

const styles = {
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 10px',
    background: '#0e1a2e',
    borderTop: '1px solid #1e3050',
    flexShrink: 0,
    fontFamily: 'system-ui, -apple-system',
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    color: '#4a90d9',
    fontWeight: 600,
    letterSpacing: '0.04em',
    flexShrink: 0,
    textTransform: 'uppercase',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#3b82f6',
    boxShadow: '0 0 6px #3b82f6',
  },
  count: {
    fontWeight: 400,
    color: '#3a5a80',
    fontSize: 10,
  },
  input: {
    flex: 1,
    background: '#0a1220',
    border: '1px solid #1e3050',
    borderRadius: 4,
    color: '#a8c8f0',
    fontSize: 12,
    padding: '4px 8px',
    outline: 'none',
    fontFamily: 'JetBrains Mono, monospace',
    minWidth: 0,
  },
  actions: {
    display: 'flex',
    gap: 4,
    flexShrink: 0,
  },
  sendBtn: {
    background: '#1a3050',
    border: '1px solid #2a5080',
    borderRadius: 4,
    color: '#60a5fa',
    fontSize: 11,
    padding: '3px 10px',
    fontFamily: 'system-ui, -apple-system',
    transition: 'opacity 0.15s',
  },
  ctrlcBtn: {
    background: 'transparent',
    border: '1px solid #2a2a2a',
    borderRadius: 4,
    color: '#555',
    fontSize: 10.5,
    padding: '3px 8px',
    cursor: 'pointer',
    fontFamily: 'monospace',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#3a5a80',
    fontSize: 16,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
};
