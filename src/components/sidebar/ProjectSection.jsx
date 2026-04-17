import React, { useState } from 'react';
import { useSessionStore } from '../../store/sessions';
import { IconFolder, IconChevron, IconEdit, IconPlus, IconTrash } from './icons';
import EditableLabel from './EditableLabel';
import SessionRow from './SessionRow';
import styles from './styles';

// ─── Project section ──────────────────────────────────────────────────────────

function ProjectSection({ project, activeSessionId, sessionStatus, onContextMenu }) {
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const {
    addSession, removeSession, renameSession, removeProject, renameProject,
    setActiveSession, updateProjectPath,
    now,
  } = useSessionStore();

  const handlePickDir = async (e) => {
    e.stopPropagation();
    const dir = await window.electronAPI.selectDir();
    if (dir) updateProjectPath(project.id, dir);
  };

  const handleAddSession = (e) => {
    e.stopPropagation();
    addSession(project.id);
  };

  const handleRemoveProject = (e) => {
    e.stopPropagation();
    if (window.confirm(`删除项目 "${project.name}" 及其所有会话？`)) {
      removeProject(project.id);
    }
  };

  const homeDir = window.electronAPI?.homeDir || '';
  const displayPath = project.path?.startsWith(homeDir)
    ? project.path.replace(homeDir, '~')
    : project.path;

  return (
    <div style={styles.projectSection}>
      {/* Project header */}
      <div
        style={{
          ...styles.projectHeader,
          background: hovered ? '#141414' : 'transparent',
        }}
        onClick={() => setCollapsed((c) => !c)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={(e) => onContextMenu?.(e, project)}
      >
        <span style={styles.chevron}>
          <IconChevron collapsed={collapsed} />
        </span>
        <span style={styles.folderIcon}><IconFolder /></span>
        <EditableLabel
          value={project.name}
          onCommit={(name) => renameProject(project.id, name)}
          style={styles.projectName}
        />
        {hovered && (
          <div style={styles.projectActions} onClick={(e) => e.stopPropagation()}>
            <button
              className="sidebar-action-btn"
              style={{ ...styles.iconBtn, color: '#aaa' }}
              onClick={handlePickDir}
              title="更改目录"
            >
              <IconEdit />
            </button>
            <button
              className="sidebar-action-btn"
              style={{ ...styles.iconBtn, color: '#aaa' }}
              onClick={handleAddSession}
              title="新建会话"
            >
              <IconPlus />
            </button>
            <button
              className="sidebar-action-btn"
              style={{ ...styles.iconBtn, color: '#aaa' }}
              onClick={handleRemoveProject}
              title="删除项目"
            >
              <IconTrash />
            </button>
          </div>
        )}
      </div>

      {/* Path label */}
      {!collapsed && displayPath && (
        <div style={styles.projectPath} title={project.path}>
          {displayPath}
        </div>
      )}

      {/* Sessions */}
      {!collapsed && project.sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          projectId={project.id}
          isActive={session.id === activeSessionId}
          status={sessionStatus?.[session.id]}
          onSelect={() => setActiveSession(session.id)}
          onRename={(name) => renameSession(project.id, session.id, name)}
          onRemove={() => removeSession(project.id, session.id)}
          now={now}
        />
      ))}
    </div>
  );
}

export default React.memo(ProjectSection);
