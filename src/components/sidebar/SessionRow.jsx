import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PencilIcon } from '../ToolIcons';
import { IconTerminal, IconTrash } from './icons';
import { getPhaseIndicator, fmtDuration, TOOL_COLORS, TOOL_LABELS } from './helpers';
import styles from './styles';

// ─── Session row ──────────────────────────────────────────────────────────────

const SessionRow = React.memo(function SessionRow({ session, projectId, isActive, onSelect, onRename, onRemove, status, now }) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  // ── Drag support: allow dragging sessions to terminal area for split ────
  const handleDragStart = useCallback((e) => {
    e.dataTransfer.setData('application/x-prism-session', session.id);
    e.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  }, [session.id]);

  const handleDragEnd = useCallback(() => {
    setDragging(false);
  }, []);

  // ── Inline rename state (lifted out of EditableLabel for direct control) ──
  // Multiple triggers can flip into edit mode: double-click, pencil button,
  // or future shortcuts. The shared state lives here so they all coexist cleanly.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.name);
  const inputRef = useRef(null);

  // Keep draft in sync with the source of truth
  useEffect(() => { setDraft(session.name); }, [session.name]);

  // Auto-focus + select-all when editing starts
  useEffect(() => {
    if (editing) {
      // Defer to next tick so the input has actually mounted
      setTimeout(() => inputRef.current?.select(), 30);
    }
  }, [editing]);

  const startEdit = (e) => {
    e?.stopPropagation();
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== session.name) onRename(trimmed);
    else setDraft(session.name);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(session.name);
  };

  const indicator = getPhaseIndicator(status);

  // Build the sub-line content (running tool + elapsed time, OR last-ran summary)
  let subLine = null;
  if (status?.tool) {
    const toolLabel = TOOL_LABELS[status.tool] || status.tool;
    const elapsed = status.startedAt ? fmtDuration(now - status.startedAt) : '';
    const phaseTag = status.phase === 'awaiting_review' ? '待审' :
                     status.phase === 'running' ? '运行中' :
                     status.phase === 'idle_no_instruction' ? '未指令' : '';
    subLine = (
      <div style={styles.sessionSubLine}>
        <span style={{ color: TOOL_COLORS[status.tool] || '#888' }}>{toolLabel}</span>
        {phaseTag && <span style={styles.subLineDim}>{'· '}{phaseTag}</span>}
        {elapsed && <span style={styles.subLineDim}>{'· '}{elapsed}</span>}
      </div>
    );
  } else if (status?.lastRanTool) {
    // No active tool but we know what ran last -- show as muted history
    const label = TOOL_LABELS[status.lastRanTool] || status.lastRanTool;
    const dur = status.lastDuration ? fmtDuration(status.lastDuration) : '';
    subLine = (
      <div style={styles.sessionSubLine}>
        <span style={styles.subLineMuted}>上次 · {label}{dur && ` · ${dur}`}</span>
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      style={{
        ...styles.sessionRow,
        ...(isActive ? styles.sessionRowActive : hovered ? styles.sessionRowHover : {}),
        ...(dragging ? { opacity: 0.5 } : {}),
        flexDirection: 'column',
        alignItems: 'stretch',
      }}
      onClick={() => { if (!editing) onSelect(); }}
      onDoubleClick={(e) => { e.stopPropagation(); startEdit(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={styles.sessionMainRow}>
        {/* Active indicator bar */}
        <span style={{ ...styles.activeBar, opacity: isActive ? 1 : 0 }} />

        <span style={{
          ...styles.sessionIcon,
          color: isActive ? '#f59e0b' : '#3a3a3a',
        }}>
          <IconTerminal />
        </span>

        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
              if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
            }}
            onClick={(e) => e.stopPropagation()}
            style={styles.renameInput}
            autoFocus
          />
        ) : (
          <span
            style={{
              ...styles.sessionName,
              color: isActive ? '#e2e8f0' : '#888',
              fontWeight: isActive ? 500 : 400,
            }}
            title="双击重命名"
          >
            {session.name}
          </span>
        )}

        {/* Phase indicator -- only when NOT hovered, so hover swaps it for actions */}
        {indicator && !editing && !hovered && (
          <span
            title={indicator.title}
            style={{
              ...styles.runningPulse,
              background: indicator.color,
              boxShadow: `0 0 6px ${indicator.color}, 0 0 2px ${indicator.color}`,
              animation: indicator.animation,
            }}
          />
        )}

        {/* Hover actions: rename + delete -- ALWAYS visible on hover, even
            when an AI tool is currently running (indicator hidden above) */}
        {hovered && !editing && (
          <div style={styles.sessionActions}>
            <button
              className="sidebar-action-btn"
              style={{ ...styles.iconBtn, color: '#aaa' }}
              onClick={startEdit}
              title="重命名"
            >
              <PencilIcon />
            </button>
            <button
              className="sidebar-action-btn"
              style={{ ...styles.iconBtn, color: '#aaa' }}
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              title="删除会话"
            >
              <IconTrash />
            </button>
          </div>
        )}
      </div>

      {subLine}
    </div>
  );
});

export default SessionRow;
