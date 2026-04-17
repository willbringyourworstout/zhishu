import React, { useState, useEffect, useCallback } from 'react';
import ContextMenu from './ContextMenu';
import { useSessionStore } from '../store/sessions';
import { isExternalDrop } from '../utils/drag';
import { IconFolder, IconFolderOpen, IconChevron, IconFile } from './sidebar/icons';

// ─── Panel resizer hook ───────────────────────────────────────────────────────
function usePanelResizer(panelType, currentWidth, setPanelWidth, commitPanelWidth) {
  const [isResizing, setIsResizing] = useState(false);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = currentWidth;

    const onMouseMove = (moveEvent) => {
      const deltaX = startX - moveEvent.clientX;
      setPanelWidth(panelType, startWidth + deltaX);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setIsResizing(false);
      commitPanelWidth();
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [panelType, currentWidth, setPanelWidth, commitPanelWidth]);

  return { isResizing, onMouseDown };
}

// ─── File / folder icons ─────────────────────────────────────────────────────
// (imported from sidebar/icons.js — shared with Sidebar)

// Git status code → letter + color (mirrors GitPanel)
const GIT_STATUS_VISUAL = {
  modified:  { letter: 'M', color: '#eab308' },
  added:     { letter: 'A', color: '#22c55e' },
  deleted:   { letter: 'D', color: '#ef4444' },
  renamed:   { letter: 'R', color: '#a855f7' },
  conflicted:{ letter: '!', color: '#f97316' },
  untracked: { letter: 'U', color: '#06b6d4' },
};

// ─── Recursive tree node ─────────────────────────────────────────────────────

function TreeNode({ item, depth, onFileSelect, gitStatusMap, rootPath, onContextMenu, refreshParent }) {
  const [collapsed, setCollapsed] = useState(true);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const isDir = item.type === 'dir';

  // Look up git status for this file (path is relative to git root)
  const relPath = rootPath && item.path.startsWith(rootPath)
    ? item.path.slice(rootPath.length + 1)
    : null;
  const gitStatus = relPath ? gitStatusMap?.[relPath] : null;
  const gitVisual = gitStatus ? GIT_STATUS_VISUAL[gitStatus] : null;

  const loadChildren = useCallback(async () => {
    setLoading(true);
    const res = await window.electronAPI.listDir(item.path);
    setLoading(false);
    setChildren(res?.items || []);
    setHasMore(!!res?.hasMore);
  }, [item.path]);

  const toggle = useCallback(async () => {
    if (!isDir) {
      onFileSelect?.(item);
      return;
    }
    if (collapsed && children === null) {
      await loadChildren();
    }
    setCollapsed((c) => !c);
  }, [isDir, collapsed, children, item, onFileSelect, loadChildren]);

  // ── Drag-and-drop: drag this file path to the terminal ──────────────
  const handleDragStart = (e) => {
    // Both formats so the terminal drop handler can pick whichever is easier
    e.dataTransfer.setData('text/plain', item.path);
    e.dataTransfer.setData('application/x-prism-file', item.path);
    e.dataTransfer.effectAllowed = 'copy';
  };

  // ── Right-click handler (called from React's onMouseDown) ──────────
  //
  // KNOWN BUG: HTML5 `draggable=true` consumes contextmenu events on its
  // host element. The reliable workaround: listen for mousedown + button===2
  // which fires BEFORE the drag system claims the event.
  const triggerContextMenu = (clientX, clientY) => {
    onContextMenu?.({
      x: clientX,
      y: clientY,
      item,
      onChanged: () => {
        if (isDir && children !== null) loadChildren();
        refreshParent?.();
      },
    });
  };

  const isHidden = item.hidden || item.name.startsWith('.');

  return (
    <div>
      <div
        onClick={(e) => {
          // Ignore right-button click — handled by onMouseDown below
          if (e.button === 2) return;
          toggle();
        }}
        onMouseDown={(e) => {
          // Right-click → trigger context menu
          // (mousedown fires before draggable's drag system claims events)
          if (e.button === 2) {
            e.preventDefault();
            e.stopPropagation();
            triggerContextMenu(e.clientX, e.clientY);
          }
        }}
        onContextMenu={(e) => {
          // Backup path: if mousedown above didn't fire (e.g. trackpad two-finger
          // tap on macOS sends contextmenu directly), trigger here too. Idempotent.
          e.preventDefault();
          e.stopPropagation();
          triggerContextMenu(e.clientX, e.clientY);
        }}
        draggable
        onDragStart={handleDragStart}
        style={{
          ...nodeStyles.row,
          paddingLeft: 8 + depth * 14,
          opacity: isHidden ? 0.55 : 1,
        }}
        className="tree-row"
      >
        {isDir ? (
          <span style={nodeStyles.chevron}><IconChevron collapsed={collapsed} /></span>
        ) : (
          <span style={nodeStyles.chevronEmpty} />
        )}
        <span style={{
          ...nodeStyles.icon,
          color: isDir ? (isHidden ? '#7a5a10' : '#f59e0b') : '#5a5a5a',
        }}>
          {isDir ? (collapsed ? <IconFolder /> : <IconFolderOpen />) : <IconFile />}
        </span>
        <span style={{
          ...nodeStyles.name,
          color: gitVisual ? gitVisual.color : nodeStyles.name.color,
        }}>{item.name}</span>
        {gitVisual && (
          <span style={{ ...nodeStyles.gitBadge, color: gitVisual.color }}>
            {gitVisual.letter}
          </span>
        )}
      </div>

      {/* Recursive children */}
      {!collapsed && children && (
        <div>
          {loading && <div style={{ ...nodeStyles.loadingHint, paddingLeft: 8 + (depth + 1) * 14 }}>...</div>}
          {children.length === 0 && (
            <div style={{ ...nodeStyles.emptyHint, paddingLeft: 8 + (depth + 1) * 14 }}>(空)</div>
          )}
          {children.map((child) => (
            <TreeNode
              key={child.path}
              item={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
              gitStatusMap={gitStatusMap}
              rootPath={rootPath}
              onContextMenu={onContextMenu}
              refreshParent={loadChildren}
            />
          ))}
          {hasMore && (
            <div style={{ ...nodeStyles.emptyHint, paddingLeft: 8 + (depth + 1) * 14, color: '#3a3a3a', fontStyle: 'normal' }}>
              ... 目录文件过多，仅显示前 500 项
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const nodeStyles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px 4px 8px',
    cursor: 'pointer',
    borderRadius: 4,
    margin: '0 4px',
    transition: 'background 0.1s',
    fontSize: 12,
    fontFamily: 'var(--font-ui)',
    color: '#a8a8a8',
    userSelect: 'none',
  },
  chevron: {
    width: 9,
    height: 9,
    color: '#3a3a3a',
    flexShrink: 0,
  },
  chevronEmpty: {
    width: 9,
    flexShrink: 0,
  },
  icon: {
    display: 'flex',
    flexShrink: 0,
  },
  name: {
    fontSize: 12,
    color: '#a8a8a8',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    minWidth: 0,
  },
  gitBadge: {
    fontSize: 10,
    fontFamily: 'var(--font-mono)',
    fontWeight: 700,
    flexShrink: 0,
    marginLeft: 4,
  },
  loadingHint: {
    fontSize: 11,
    color: '#3a3a3a',
    padding: '4px 10px',
    fontFamily: 'var(--font-mono)',
  },
  emptyHint: {
    fontSize: 11,
    color: '#2a2a2a',
    padding: '4px 10px',
    fontStyle: 'italic',
  },
};

// ─── Main panel — slides in from the right side ──────────────────────────────

export default function FileTreePanel() {
  const open = useSessionStore((s) => s.fileTreeOpen);
  const onClose = useSessionStore((s) => s.closeFileTree);
  const openFilePreview = useSessionStore((s) => s.openFilePreview);
  const getActiveProject = useSessionStore((s) => s.getActiveProject);
  const fileTreeWidth = useSessionStore((s) => s.fileTreeWidth);
  const setPanelWidth = useSessionStore((s) => s.setPanelWidth);
  const commitPanelWidth = useSessionStore((s) => s.commitPanelWidth);
  const addProject = useSessionStore((s) => s.addProject);
  const addToast = useSessionStore((s) => s.addToast);

  const { isResizing, onMouseDown: onResizerMouseDown } = usePanelResizer(
    'file', fileTreeWidth, setPanelWidth, commitPanelWidth
  );

  const activeProject = getActiveProject();
  const cwd = activeProject?.path || null;

  const [rootItems, setRootItems] = useState([]);
  const [rootHasMore, setRootHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gitStatusMap, setGitStatusMap] = useState({});
  // Right-click menu state
  const [ctxMenu, setCtxMenu] = useState(null);
  // Filter input
  const [filter, setFilter] = useState('');
  // Custom prompt (replaces window.prompt)
  const showPrompt = useSessionStore((s) => s.showPrompt);
  // External drag-over highlight
  const [isDragOver, setIsDragOver] = useState(false);

  // Fetch dir + git status in parallel
  const loadAll = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    const [dirRes, gitRes] = await Promise.all([
      window.electronAPI.listDir(cwd),
      window.electronAPI.gitStatus(cwd),
    ]);
    setRootItems(dirRes?.items || []);
    setRootHasMore(!!dirRes?.hasMore);

    // Build the path → status map (only if this dir is a git repo)
    const map = {};
    if (gitRes?.isRepo && gitRes.files) {
      for (const f of gitRes.files) {
        map[f.path] = f.status;
      }
    }
    setGitStatusMap(map);
    setLoading(false);
  }, [cwd]);

  useEffect(() => {
    if (!open || !cwd) return;
    loadAll();
  }, [open, cwd, loadAll]);

  const refresh = loadAll;

  // ── External drag-drop: Finder → FileTreePanel ──────────────────────
  //
  // dragenter / dragover: show highlight and set dropEffect
  // dragleave: clear highlight (guard against child elements firing it)
  // drop: classify files vs folders, then either import or add as project
  const dragCounterRef = React.useRef(0);

  const handleTreeDragEnter = useCallback((e) => {
    if (!isExternalDrop(e)) return;
    dragCounterRef.current += 1;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
  }, []);

  const handleTreeDragOver = useCallback((e) => {
    if (!isExternalDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleTreeDragLeave = useCallback((e) => {
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleTreeDrop = useCallback(async (e) => {
    // Mark as handled so the global drop guard in index.js skips preventDefault
    e._handled = true;
    e.preventDefault();
    e.stopPropagation();

    setIsDragOver(false);
    dragCounterRef.current = 0;

    if (!isExternalDrop(e)) return;

    const filePaths = [];
    const folderPaths = [];

    for (const item of Array.from(e.dataTransfer.items)) {
      const entry = item.webkitGetAsEntry?.();
      const file = item.getAsFile?.();
      if (!file?.path) continue;
      if (entry?.isDirectory) {
        folderPaths.push(file.path);
      } else {
        filePaths.push(file.path);
      }
    }

    // Folders → add each as a new project
    for (const folderPath of folderPaths) {
      const name = folderPath.split('/').filter(Boolean).pop() || folderPath;
      addProject(name, folderPath);
      addToast({ message: `已添加项目: ${name}`, type: 'success' });
    }

    // Files → copy into current project cwd
    if (filePaths.length > 0 && cwd) {
      try {
        const result = await window.electronAPI.importExternal(filePaths, cwd);
        if (!result?.ok && !result?.results) {
          addToast({ message: '导入失败', type: 'error' });
          return;
        }
        const results = result.results || [];
        const okCount = results.filter((r) => r.status === 'ok').length;
        const renamedCount = results.filter((r) => r.status === 'renamed').length;
        const errorCount = results.filter((r) => r.status === 'error').length;

        let msg = '';
        if (okCount > 0 && renamedCount === 0 && errorCount === 0) {
          msg = `成功导入 ${okCount} 个文件`;
        } else {
          const parts = [];
          if (okCount > 0) parts.push(`成功 ${okCount}`);
          if (renamedCount > 0) parts.push(`自动重命名 ${renamedCount} 个（同名冲突）`);
          if (errorCount > 0) parts.push(`失败 ${errorCount}`);
          msg = `导入完成：${parts.join('，')}`;
        }

        const toastType = errorCount > 0 && okCount === 0 && renamedCount === 0 ? 'error' : 'success';
        addToast({ message: msg, type: toastType });

        // Refresh tree to show newly imported files
        await refresh();
      } catch (err) {
        console.error('importExternal error:', err);
        addToast({ message: `导入出错: ${err.message || err}`, type: 'error' });
      }
    } else if (filePaths.length > 0 && !cwd) {
      addToast({ message: '请先打开一个项目再拖入文件', type: 'error' });
    }
  }, [cwd, addProject, addToast, refresh]);

  // ── File operation handlers (called from the context menu) ──────────
  const buildContextMenuItems = ({ item, onChanged }) => {
    const isDir = item.type === 'dir';
    const items = [];

    if (isDir) {
      items.push({
        label: '新建文件',
        icon: '＋',
        onClick: async () => {
          const name = await showPrompt({ title: '新建文件', defaultValue: 'untitled.txt' });
          if (!name) return;
          const r = await window.electronAPI.newFile(item.path, name);
          if (r?.error) return alert(r.error);
          onChanged();
        },
      });
      items.push({
        label: '新建文件夹',
        icon: '◰',
        onClick: async () => {
          const name = await showPrompt({ title: '新建文件夹', defaultValue: 'new-folder' });
          if (!name) return;
          const r = await window.electronAPI.newFolder(item.path, name);
          if (r?.error) return alert(r.error);
          onChanged();
        },
      });
      items.push({ separator: true });
    }

    // Only show "在预览中打开" for files (not directories)
    if (!isDir) {
      items.push({
        label: '在预览中打开',
        icon: '◫',
        onClick: () => openFilePreview(item.path, item.name),
      });
    }
    items.push({
      label: '打开',
      icon: '↗',
      onClick: () => window.electronAPI.openFile(item.path),
    });
    items.push({
      label: '在 Finder 中显示',
      icon: '⌖',
      onClick: () => window.electronAPI.revealInFinder(item.path),
    });
    items.push({
      label: '复制路径',
      icon: '⎘',
      onClick: () => navigator.clipboard.writeText(item.path),
    });
    items.push({ separator: true });

    items.push({
      label: '重命名',
      icon: '✎',
      onClick: async () => {
        const newName = await showPrompt({ title: '重命名', defaultValue: item.name });
        if (!newName || newName === item.name) return;
        const r = await window.electronAPI.renameFile(item.path, newName);
        if (r?.error) return alert(r.error);
        onChanged();
      },
    });
    items.push({
      label: '复制副本',
      icon: '⊕',
      onClick: async () => {
        const dest = `${item.path}.copy`;
        const r = await window.electronAPI.copyFile(item.path, dest);
        if (r?.error) return alert(r.error);
        onChanged();
      },
    });
    items.push({
      label: '压缩为 zip',
      icon: '🗜',
      onClick: async () => {
        const r = await window.electronAPI.zipFile(item.path);
        if (r?.error) return alert(r.error);
        onChanged();
      },
    });
    items.push({ separator: true });
    items.push({
      label: '移到废纸篓',
      icon: '🗑',
      danger: true,
      onClick: async () => {
        if (!window.confirm(`确定将 "${item.name}" 移到废纸篓？`)) return;
        const r = await window.electronAPI.trashFile(item.path);
        if (r?.error) return alert(r.error);
        onChanged();
      },
    });

    return items;
  };

  const onContextMenu = (payload) => {
    const items = buildContextMenuItems(payload);
    setCtxMenu({ x: payload.x, y: payload.y, items });
  };

  // Filter the visible top-level items by name (case-insensitive)
  const filteredItems = filter
    ? rootItems.filter((it) => it.name.toLowerCase().includes(filter.toLowerCase()))
    : rootItems;

  const homeDir = window.electronAPI?.homeDir || '';
  const displayCwd = cwd?.startsWith(homeDir) ? cwd.replace(homeDir, '~') : cwd;

  // Early-return AFTER all hooks to comply with Rules of Hooks
  if (!open) return null;

  return (
    <div
      style={{
        ...styles.panel,
        width: fileTreeWidth,
        transition: isResizing ? 'none' : 'width 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Left-edge resizer handle */}
      <div
        className="panel-resizer"
        style={styles.resizer}
        onMouseDown={onResizerMouseDown}
      />
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.headerTitle}>文件浏览器</span>
        </div>
        <div style={styles.headerActions}>
          <button
            style={styles.iconBtn}
            onClick={async () => {
              const name = await showPrompt({ title: '新建文件', defaultValue: 'untitled.txt' });
              if (!name) return;
              const r = await window.electronAPI.newFile(cwd, name);
              if (r?.error) alert(r.error); else refresh();
            }}
            title="新建文件"
          >＋</button>
          <button
            style={styles.iconBtn}
            onClick={async () => {
              const name = await showPrompt({ title: '新建文件夹', defaultValue: 'new-folder' });
              if (!name) return;
              const r = await window.electronAPI.newFolder(cwd, name);
              if (r?.error) alert(r.error); else refresh();
            }}
            title="新建文件夹"
          >◰</button>
          <button style={styles.iconBtn} onClick={refresh} title="刷新">↻</button>
          <button style={styles.iconBtn} onClick={onClose} title="关闭">×</button>
        </div>
      </div>

      {/* Path bar */}
      <div style={styles.pathBar} title={cwd}>
        <span style={styles.pathIcon}>▸</span>
        <span style={styles.pathText}>{displayCwd || '~'}</span>
      </div>

      {/* Filter input */}
      <div style={styles.filterBar}>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤..."
          style={styles.filterInput}
        />
        {filter && (
          <button onClick={() => setFilter('')} style={styles.clearBtn}>×</button>
        )}
      </div>

      {/* Tree — also serves as the external file drop zone */}
      <div
        style={{
          ...styles.tree,
          ...(isDragOver ? styles.treeDragOver : {}),
        }}
        onDragEnter={handleTreeDragEnter}
        onDragOver={handleTreeDragOver}
        onDragLeave={handleTreeDragLeave}
        onDrop={handleTreeDrop}
      >
        {isDragOver && (
          <div style={styles.dropOverlay}>
            <span style={styles.dropOverlayText}>
              {cwd ? '拖入以导入文件 / 添加文件夹为项目' : '拖入文件夹以添加新项目'}
            </span>
          </div>
        )}
        {loading && <div style={styles.placeholder}>加载中...</div>}
        {!loading && filteredItems.length === 0 && (
          <div style={styles.placeholder}>{filter ? '无匹配' : '(空目录)'}</div>
        )}
        {!loading && filteredItems.map((item) => (
          <TreeNode
            key={item.path}
            item={item}
            depth={0}
            onFileSelect={(file) => openFilePreview(file.path, file.name)}
            gitStatusMap={gitStatusMap}
            rootPath={cwd}
            onContextMenu={onContextMenu}
            refreshParent={refresh}
          />
        ))}
        {!loading && rootHasMore && !filter && (
          <div style={{ ...styles.placeholder, padding: '12px 14px', fontStyle: 'normal', color: '#3a3a3a' }}>
            ... 目录文件过多，仅显示前 500 项
          </div>
        )}
      </div>

      {/* Context menu overlay */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

const styles = {
  panel: {
    position: 'relative',
    flexShrink: 0,
    background: '#0b0b0b',
    borderLeft: '1px solid #1a1a1a',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  resizer: {
    position: 'absolute',
    top: 0,
    left: -3,
    width: 6,
    height: '100%',
    cursor: 'col-resize',
    background: 'transparent',
    zIndex: 100,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    borderBottom: '1px solid #161616',
    background: '#0d0d0d',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerIcon: {
    fontSize: 13,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#d0d0d0',
    fontFamily: 'var(--font-ui)',
    letterSpacing: '-0.005em',
  },
  headerActions: {
    display: 'flex',
    gap: 4,
  },
  iconBtn: {
    background: 'transparent',
    border: 'none',
    color: '#555',
    fontSize: 14,
    cursor: 'pointer',
    width: 22,
    height: 22,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 3,
    padding: 0,
    lineHeight: 1,
  },
  pathBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 14px',
    background: '#080808',
    borderBottom: '1px solid #141414',
    fontSize: 10,
    fontFamily: 'var(--font-mono)',
    color: '#4a4a4a',
    flexShrink: 0,
  },
  pathIcon: { color: '#2a2a2a' },
  pathText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 12px',
    background: '#0a0a0a',
    borderBottom: '1px solid #141414',
    flexShrink: 0,
  },
  filterInput: {
    flex: 1,
    background: '#111',
    border: '1px solid #1e1e1e',
    borderRadius: 4,
    color: '#d0d0d0',
    fontSize: 11,
    padding: '4px 8px',
    outline: 'none',
    fontFamily: 'var(--font-ui)',
  },
  clearBtn: {
    background: 'transparent',
    border: 'none',
    color: '#555',
    fontSize: 14,
    cursor: 'pointer',
    width: 18,
    height: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    lineHeight: 1,
  },
  tree: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '6px 0',
  },
  placeholder: {
    fontSize: 11,
    color: '#3a3a3a',
    padding: '20px 14px',
    fontFamily: 'var(--font-mono)',
    textAlign: 'center',
  },
  // External drag-over highlight on the tree area
  treeDragOver: {
    boxShadow: 'inset 0 0 0 2px rgba(245, 158, 11, 0.55)',
    background: 'rgba(245, 158, 11, 0.03)',
    position: 'relative',
  },
  dropOverlay: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px 14px',
    background: 'rgba(245, 158, 11, 0.08)',
    borderBottom: '1px solid rgba(245, 158, 11, 0.2)',
    pointerEvents: 'none',
  },
  dropOverlayText: {
    fontSize: 11,
    color: '#f59e0b',
    fontFamily: 'var(--font-ui)',
    fontWeight: 500,
    textAlign: 'center',
    lineHeight: 1.4,
  },
};
