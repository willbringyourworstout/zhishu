import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useSessionStore } from '../store/sessions';
import { ChecklistIcon } from './ToolIcons';
import TodoAIChat from './TodoAIChat';

// ─── Priority config ─────────────────────────────────────────────────────────

const PRIORITY = {
  none:   { label: '无',  color: '#444',    glow: 'transparent' },
  low:    { label: '低',  color: '#22c55e', glow: '#22c55e40' },
  medium: { label: '中',  color: '#f59e0b', glow: '#f59e0b40' },
  high:   { label: '高',  color: '#ef4444', glow: '#ef444440' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDue(dueDate) {
  if (!dueDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) return { label: '已逾期', overdue: true };
  if (dueDate === today) return { label: '今天截止', today: true };
  const d = new Date(`${dueDate}T00:00:00`);
  const diffDays = Math.round((d - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (diffDays <= 3) return { label: `${diffDays} 天后`, soon: true };
  return {
    label: d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
    far: true,
  };
}

// ─── TodoItem ────────────────────────────────────────────────────────────────

function TodoItem({ todo, onToggle, onDelete, onUpdate, onSetStatus }) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(todo.text);
  const editRef = useRef(null);

  const due = formatDue(todo.dueDate);
  const pri = PRIORITY[todo.priority] || PRIORITY.none;
  const isInProgress = todo.status === 'in_progress';

  const startEdit = () => {
    if (todo.done) return;
    setEditText(todo.text);
    setEditing(true);
  };

  const commitEdit = () => {
    const t = editText.trim();
    if (t && t !== todo.text) onUpdate(todo.id, { text: t });
    setEditing(false);
  };

  const onEditKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { setEditing(false); setEditText(todo.text); }
  };

  useEffect(() => {
    if (editing && editRef.current) editRef.current.focus();
  }, [editing]);

  return (
    <div
      style={{
        ...itemStyles.row,
        background: hovered ? '#161616'
          : isInProgress ? 'rgba(245, 158, 11, 0.04)'
          : 'transparent',
        borderLeft: `2px solid ${
          isInProgress ? '#f59e0b'
          : todo.priority !== 'none' ? pri.color
          : 'transparent'
        }`,
        opacity: todo.done ? 0.5 : 1,
        ...(isInProgress ? { animation: 'todo-pulse 2.5s ease-in-out infinite' } : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Checkbox / Progress indicator */}
      {isInProgress ? (
        <div style={itemStyles.progressDot} title="正在进行中">
          <span style={itemStyles.progressSpinner} />
        </div>
      ) : (
        <button
          onClick={() => onToggle(todo.id)}
          style={{
            ...itemStyles.checkbox,
            borderColor: todo.done ? pri.color : '#3a3a3a',
            background: todo.done ? `${pri.color}20` : 'transparent',
            flexShrink: 0,
          }}
          title={todo.done ? '标记为未完成' : '标记为完成'}
        >
          {todo.done && <span style={itemStyles.checkmark}>✓</span>}
        </button>
      )}

      {/* Content */}
      <div style={itemStyles.content}>
        {editing ? (
          <input
            ref={editRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={onEditKey}
            onBlur={commitEdit}
            style={itemStyles.editInput}
          />
        ) : (
          <span
            style={{
              ...itemStyles.text,
              textDecoration: todo.done ? 'line-through' : 'none',
              color: todo.done ? '#444' : isInProgress ? '#f0f0f0' : '#d4d4d4',
            }}
            onDoubleClick={startEdit}
            title={todo.done ? '' : '双击编辑'}
          >
            {todo.text}
          </span>
        )}

        {due && !todo.done && (
          <span
            style={{
              ...itemStyles.dueLabel,
              color: due.overdue ? '#ef4444'
                   : due.today  ? '#f59e0b'
                   : due.soon   ? '#8b8b8b'
                   : '#555',
            }}
          >
            {due.overdue && '⚠ '}{due.label}
          </span>
        )}
      </div>

      {/* Hover actions */}
      {hovered && (
        <div style={itemStyles.actions}>
          {!todo.done && (
            <button
              onClick={() => onSetStatus(todo.id, isInProgress ? 'todo' : 'in_progress')}
              style={itemStyles.actionBtn}
              title={isInProgress ? '暂停任务' : '开始任务'}
            >
              {isInProgress ? '⏸' : '▶'}
            </button>
          )}
          {!todo.done && (
            <button onClick={startEdit} style={itemStyles.actionBtn} title="编辑">
              ✎
            </button>
          )}
          <button
            onClick={() => onDelete(todo.id)}
            style={{ ...itemStyles.actionBtn, color: '#ef444480' }}
            title="删除"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

const itemStyles = {
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '6px 10px 6px 8px',
    borderRadius: 5,
    cursor: 'default',
    transition: 'background 0.12s',
    marginBottom: 1,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    border: '1.5px solid #3a3a3a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    background: 'transparent',
    transition: 'all 0.15s',
    padding: 0,
    marginTop: 2,
  },
  checkmark: {
    fontSize: 10,
    color: '#22c55e',
    lineHeight: 1,
    fontWeight: 700,
  },
  progressDot: {
    width: 16,
    height: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  progressSpinner: {
    display: 'inline-block',
    width: 12,
    height: 12,
    border: '2px solid #f59e0b40',
    borderTopColor: '#f59e0b',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  content: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  text: {
    fontSize: 12.5,
    lineHeight: 1.4,
    wordBreak: 'break-word',
    fontFamily: 'system-ui, -apple-system',
  },
  dueLabel: {
    fontSize: 10.5,
    fontFamily: 'system-ui, -apple-system',
  },
  editInput: {
    width: '100%',
    background: '#1e1e1e',
    border: '1px solid #383838',
    borderRadius: 4,
    color: '#e0e0e0',
    fontSize: 12.5,
    padding: '2px 6px',
    outline: 'none',
    fontFamily: 'system-ui, -apple-system',
  },
  actions: {
    display: 'flex',
    gap: 2,
    flexShrink: 0,
    marginTop: 1,
  },
  actionBtn: {
    background: 'transparent',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    fontSize: 13,
    padding: '1px 4px',
    borderRadius: 3,
    lineHeight: 1,
    transition: 'color 0.12s',
  },
};

// ─── Project selector bar ────────────────────────────────────────────────────

function ProjectSelector({ projects, todos, todoFocusProjectId, onSelect }) {
  return (
    <div style={selectorStyles.bar}>
      <button
        onClick={() => onSelect(null)}
        style={{
          ...selectorStyles.btn,
          background: todoFocusProjectId === null ? '#1a2840' : 'transparent',
          borderBottom: todoFocusProjectId === null ? '1.5px solid #60a5fa' : '1.5px solid transparent',
          color: todoFocusProjectId === null ? '#b0c4de' : '#555',
        }}
      >
        全部
      </button>
      {projects.map((p) => {
        const count = todos.filter(t => t.projectId === p.id && t.status !== 'done').length;
        const isActive = todoFocusProjectId === p.id;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            style={{
              ...selectorStyles.btn,
              background: isActive ? '#1a2840' : 'transparent',
              borderBottom: isActive ? '1.5px solid #60a5fa' : '1.5px solid transparent',
              color: isActive ? '#b0c4de' : '#555',
            }}
          >
            {p.name}
            {count > 0 && (
              <span style={{
                ...selectorStyles.count,
                color: isActive ? '#60a5fa' : '#3d3d3d',
              }}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const selectorStyles = {
  bar: {
    display: 'flex',
    gap: 0,
    padding: '0 10px',
    overflowX: 'auto',
    flexShrink: 0,
    borderBottom: '1px solid #1a1a1a',
  },
  btn: {
    background: 'transparent',
    border: 'none',
    borderBottom: '1.5px solid transparent',
    fontSize: 11,
    padding: '6px 8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    fontFamily: 'system-ui, -apple-system',
    whiteSpace: 'nowrap',
    transition: 'color 0.12s, background 0.12s, border-color 0.12s',
    borderRadius: 0,
  },
  count: {
    fontSize: 9.5,
    fontWeight: 600,
  },
};

// ─── AddForm ─────────────────────────────────────────────────────────────────

function AddForm({ onAdd, onClose, projects, todoFocusProjectId }) {
  const [text, setText] = useState('');
  const [priority, setPriority] = useState('none');
  const [dueDate, setDueDate] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(todoFocusProjectId || '');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleAdd = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t, priority, dueDate || null, selectedProjectId || null);
    setText('');
    setPriority('none');
    setDueDate('');
    // Keep form open for rapid entry
    inputRef.current?.focus();
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd(); }
    if (e.key === 'Escape') onClose();
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={addFormStyles.wrap}>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="输入待办内容… (Enter 添加)"
        style={addFormStyles.input}
      />
      <div style={addFormStyles.row}>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          style={addFormStyles.select}
        >
          <option value="none">无优先级</option>
          <option value="low">低优先级</option>
          <option value="medium">中优先级</option>
          <option value="high">高优先级</option>
        </select>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          style={addFormStyles.select}
          title="关联项目"
        >
          <option value="">（全局）</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          min={today}
          style={addFormStyles.dateInput}
          title="截止日期（可选）"
        />
      </div>
      <div style={addFormStyles.actions}>
        <button
          onClick={handleAdd}
          disabled={!text.trim()}
          style={{
            ...addFormStyles.addBtn,
            opacity: text.trim() ? 1 : 0.4,
            cursor: text.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          添加
        </button>
        <button onClick={onClose} style={addFormStyles.cancelBtn}>
          取消
        </button>
      </div>
    </div>
  );
}

const addFormStyles = {
  wrap: {
    padding: '8px 10px',
    borderBottom: '1px solid #1e1e1e',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  input: {
    width: '100%',
    background: '#1a1a1a',
    border: '1px solid #2e2e2e',
    borderRadius: 5,
    color: '#e0e0e0',
    fontSize: 12.5,
    padding: '6px 8px',
    outline: 'none',
    fontFamily: 'system-ui, -apple-system',
    boxSizing: 'border-box',
  },
  row: {
    display: 'flex',
    gap: 4,
  },
  select: {
    flex: 1,
    background: '#1a1a1a',
    border: '1px solid #2e2e2e',
    borderRadius: 4,
    color: '#a0a0a0',
    fontSize: 11,
    padding: '4px 6px',
    outline: 'none',
    fontFamily: 'system-ui, -apple-system',
    cursor: 'pointer',
    minWidth: 0,
  },
  dateInput: {
    flex: 1,
    background: '#1a1a1a',
    border: '1px solid #2e2e2e',
    borderRadius: 4,
    color: '#a0a0a0',
    fontSize: 11,
    padding: '4px 6px',
    outline: 'none',
    fontFamily: 'system-ui, -apple-system',
    minWidth: 0,
  },
  actions: {
    display: 'flex',
    gap: 6,
  },
  addBtn: {
    flex: 1,
    background: '#1d3a1d',
    border: '1px solid #2d5a2d',
    borderRadius: 4,
    color: '#4ade80',
    fontSize: 12,
    padding: '5px 0',
    fontFamily: 'system-ui, -apple-system',
    fontWeight: 500,
    transition: 'opacity 0.15s',
  },
  cancelBtn: {
    flex: 1,
    background: 'transparent',
    border: '1px solid #2e2e2e',
    borderRadius: 4,
    color: '#666',
    fontSize: 12,
    padding: '5px 0',
    cursor: 'pointer',
    fontFamily: 'system-ui, -apple-system',
  },
};

// ─── Main TodoPanel ──────────────────────────────────────────────────────────

export default function TodoPanel() {
  const todoPanelOpen    = useSessionStore((s) => s.todoPanelOpen);
  const closeTodoPanel   = useSessionStore((s) => s.closeTodoPanel);
  const todos            = useSessionStore((s) => s.todos);
  const projects         = useSessionStore((s) => s.projects);
  const addTodo          = useSessionStore((s) => s.addTodo);
  const updateTodo       = useSessionStore((s) => s.updateTodo);
  const deleteTodo       = useSessionStore((s) => s.deleteTodo);
  const toggleTodoDone   = useSessionStore((s) => s.toggleTodoDone);
  const setTodoStatus    = useSessionStore((s) => s.setTodoStatus);
  const clearDoneTodos   = useSessionStore((s) => s.clearDoneTodos);
  const setTodoFocusProject = useSessionStore((s) => s.setTodoFocusProject);
  const todoFocusProjectId  = useSessionStore((s) => s.todoFocusProjectId);
  const todoPanelWidth   = useSessionStore((s) => s.todoPanelWidth);
  const setPanelWidth    = useSessionStore((s) => s.setPanelWidth);
  const commitPanelWidth = useSessionStore((s) => s.commitPanelWidth);

  const [filter, setFilter] = useState('active'); // 'all' | 'active' | 'done'
  const [showAddForm, setShowAddForm] = useState(false);

  const panelRef  = useRef(null);
  const resizerRef = useRef(null);

  // ── Resizer (drag left edge) ──────────────────────────────────────────────
  useEffect(() => {
    const resizer = resizerRef.current;
    const panel   = panelRef.current;
    if (!resizer || !panel) return;

    let startX, startWidth;

    const onMouseDown = (e) => {
      startX = e.clientX;
      startWidth = panel.getBoundingClientRect().width;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      setPanelWidth('todo', startWidth + (startX - e.clientX));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      commitPanelWidth();
    };

    resizer.addEventListener('mousedown', onMouseDown);
    return () => resizer.removeEventListener('mousedown', onMouseDown);
  }, [setPanelWidth, commitPanelWidth]);

  const handleAdd = useCallback((text, priority, dueDate, projectId) => {
    addTodo(text, priority, dueDate, projectId);
  }, [addTodo]);

  if (!todoPanelOpen) return null;

  // ── Filter by project ─────────────────────────────────────────────────────
  const projectFiltered = todoFocusProjectId !== null
    ? todos.filter((t) => t.projectId === todoFocusProjectId)
    : todos;

  // ── Derived data ──────────────────────────────────────────────────────────
  const activeCount  = projectFiltered.filter((t) => t.status !== 'done').length;
  const doneCount    = projectFiltered.filter((t) => t.status === 'done').length;
  const totalCount   = projectFiltered.length;
  const overdueCount = projectFiltered.filter((t) => {
    if (t.status === 'done' || !t.dueDate) return false;
    return t.dueDate < new Date().toISOString().slice(0, 10);
  }).length;

  const filtered = projectFiltered.filter((t) => {
    if (filter === 'active') return t.status !== 'done';
    if (filter === 'done')   return t.status === 'done';
    return true;
  });

  // Sort: in_progress first, then undone (overdue -> high -> medium -> low -> none), then by createdAt; done last
  const pOrder = { high: 0, medium: 1, low: 2, none: 3 };
  const today  = new Date().toISOString().slice(0, 10);
  const sorted = [...filtered].sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    // in_progress floats to top among undone items
    if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
    if (a.status !== 'in_progress' && b.status === 'in_progress') return 1;
    // Overdue items float to top
    const aOv = a.status !== 'done' && a.dueDate && a.dueDate < today;
    const bOv = b.status !== 'done' && b.dueDate && b.dueDate < today;
    if (aOv !== bOv) return aOv ? -1 : 1;
    const pa = pOrder[a.priority] ?? 3;
    const pb = pOrder[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    return a.createdAt - b.createdAt;
  });

  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div ref={panelRef} style={{ ...panelStyles.panel, width: todoPanelWidth }}>
      {/* Resizer handle on the left edge */}
      <div
        ref={resizerRef}
        style={panelStyles.resizer}
        title="拖拽调整宽度"
      />

      {/* ── Header ── */}
      <div style={panelStyles.header}>
        <div style={panelStyles.headerLeft}>
          <ChecklistIcon size={13} color="#7a7a7a" />
          <span style={panelStyles.title}>待办</span>
          {activeCount > 0 && (
            <span style={{
              ...panelStyles.badge,
              background: overdueCount > 0 ? '#4a1a1a' : '#1a2a3a',
              color: overdueCount > 0 ? '#ef4444' : '#60a5fa',
              border: `1px solid ${overdueCount > 0 ? '#6b2828' : '#2a4a6a'}`,
            }}>
              {overdueCount > 0 ? `${overdueCount} 逾期` : activeCount}
            </span>
          )}
        </div>
        <div style={panelStyles.headerRight}>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            style={{
              ...panelStyles.headerBtn,
              color: showAddForm ? '#f59e0b' : '#666',
              fontSize: 16,
              lineHeight: 1,
            }}
            title="添加待办 (点击展开)"
          >
            +
          </button>
          <button
            onClick={closeTodoPanel}
            style={panelStyles.headerBtn}
            title="关闭待办面板"
          >
            ×
          </button>
        </div>
      </div>

      {/* ── Project selector ── */}
      <ProjectSelector
        projects={projects}
        todos={todos}
        todoFocusProjectId={todoFocusProjectId}
        onSelect={setTodoFocusProject}
      />

      {/* ── Progress bar ── */}
      {totalCount > 0 && (
        <div style={panelStyles.progressArea}>
          <div style={panelStyles.progressTrack}>
            <div
              style={{
                ...panelStyles.progressFill,
                width: `${progressPct}%`,
                background: progressPct === 100 ? '#22c55e' : '#3b82f6',
              }}
            />
          </div>
          <span style={panelStyles.progressLabel}>
            {progressPct === 100 ? '全部完成 ✓' : `${doneCount} / ${totalCount} 完成`}
          </span>
        </div>
      )}

      {/* ── Add form ── */}
      {showAddForm && (
        <AddForm
          onAdd={handleAdd}
          onClose={() => setShowAddForm(false)}
          projects={projects}
          todoFocusProjectId={todoFocusProjectId}
        />
      )}

      {/* ── Filter tabs ── */}
      <div style={panelStyles.tabs}>
        {[
          ['active', '进行中', activeCount],
          ['all',    '全部',   totalCount],
          ['done',   '已完成', doneCount],
        ].map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              ...panelStyles.tab,
              color: filter === key ? '#e0e0e0' : '#555',
              borderBottom: filter === key ? '1px solid #f59e0b' : '1px solid transparent',
            }}
          >
            {label}
            {count > 0 && (
              <span style={{
                ...panelStyles.tabCount,
                color: filter === key ? '#a0a0a0' : '#3d3d3d',
              }}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Todo list ── */}
      <div style={panelStyles.list}>
        {sorted.length === 0 ? (
          <div style={panelStyles.empty}>
            {filter === 'done'   ? '还没有完成的待办'
           : filter === 'active' ? '没有进行中的待办 ✓'
           : '点击 + 添加第一条待办'}
          </div>
        ) : (
          sorted.map((todo) => (
            <TodoItem
              key={todo.id}
              todo={todo}
              onToggle={toggleTodoDone}
              onDelete={deleteTodo}
              onUpdate={updateTodo}
              onSetStatus={setTodoStatus}
            />
          ))
        )}
      </div>

      {/* ── Footer ── */}
      {doneCount > 0 && (
        <div style={panelStyles.footer}>
          <button onClick={clearDoneTodos} style={panelStyles.clearBtn}>
            清除已完成 ({doneCount})
          </button>
        </div>
      )}

      {/* ── AI Chat ── */}
      <TodoAIChat />
    </div>
  );
}

// ─── Panel-level styles ───────────────────────────────────────────────────────

const panelStyles = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#0e0e0e',
    borderLeft: '1px solid #1e1e1e',
    position: 'relative',
    flexShrink: 0,
    overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system',
  },
  resizer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    cursor: 'col-resize',
    zIndex: 10,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 10px 0 14px',
    height: 40,
    borderBottom: '1px solid #1a1a1a',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: '#8b8b8b',
    letterSpacing: '0.02em',
  },
  badge: {
    fontSize: 10,
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: 10,
    letterSpacing: '0.02em',
  },
  headerRight: {
    display: 'flex',
    gap: 2,
  },
  headerBtn: {
    background: 'transparent',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    fontSize: 14,
    padding: '3px 5px',
    borderRadius: 4,
    lineHeight: 1,
    transition: 'color 0.12s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'system-ui, -apple-system',
  },
  progressArea: {
    padding: '6px 12px 4px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    background: '#1e1e1e',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 0.35s ease, background 0.35s',
  },
  progressLabel: {
    fontSize: 10.5,
    color: '#444',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #1a1a1a',
    padding: '0 10px',
    flexShrink: 0,
  },
  tab: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    fontSize: 11.5,
    padding: '7px 4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    transition: 'color 0.12s, border-color 0.12s',
    fontFamily: 'system-ui, -apple-system',
  },
  tabCount: {
    fontSize: 10,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 2px',
  },
  empty: {
    padding: '24px 16px',
    textAlign: 'center',
    color: '#333',
    fontSize: 12,
    lineHeight: 1.6,
  },
  footer: {
    borderTop: '1px solid #1a1a1a',
    padding: '6px 10px',
    flexShrink: 0,
  },
  clearBtn: {
    width: '100%',
    background: 'transparent',
    border: '1px solid #2a2a2a',
    borderRadius: 4,
    color: '#555',
    fontSize: 11.5,
    padding: '5px 0',
    cursor: 'pointer',
    fontFamily: 'system-ui, -apple-system',
    transition: 'color 0.12s, border-color 0.12s',
  },
};
