import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSessionStore } from '../store/sessions';

/**
 * PromptTemplate - dropdown panel for selecting / managing prompt templates.
 *
 * Renders as an absolutely-positioned panel anchored below the triggering button.
 * Built-in templates are shown first (not editable/deletable), followed by custom ones.
 */
export default function PromptTemplate({ sessionId, anchorRef, onClose }) {
  const promptTemplates = useSessionStore((s) => s.promptTemplates);
  const addPromptTemplate = useSessionStore((s) => s.addPromptTemplate);
  const removePromptTemplate = useSessionStore((s) => s.removePromptTemplate);
  const updatePromptTemplate = useSessionStore((s) => s.updatePromptTemplate);
  const addToast = useSessionStore((s) => s.addToast);

  const [mode, setMode] = useState('list'); // 'list' | 'add' | 'edit'
  const [editTarget, setEditTarget] = useState(null);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const panelRef = useRef(null);
  const titleInputRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        anchorRef?.current &&
        !anchorRef.current.contains(e.target)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [anchorRef, onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        if (mode !== 'list') {
          setMode('list');
          setEditTarget(null);
          setFormTitle('');
          setFormContent('');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mode, onClose]);

  // Focus the title input when entering add/edit mode
  useEffect(() => {
    if ((mode === 'add' || mode === 'edit') && titleInputRef.current) {
      setTimeout(() => titleInputRef.current?.focus(), 30);
    }
  }, [mode]);

  const handleSend = useCallback((template) => {
    window.electronAPI.writePty(sessionId, template.content + '\n');
    addToast({
      kind: 'info',
      title: '已发送模板',
      body: template.title,
      color: '#f59e0b',
    });
    onClose();
  }, [sessionId, addToast, onClose]);

  const handleAdd = () => {
    setMode('add');
    setFormTitle('');
    setFormContent('');
  };

  const handleEdit = (template) => {
    setMode('edit');
    setEditTarget(template);
    setFormTitle(template.title);
    setFormContent(template.content);
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    const title = formTitle.trim();
    const content = formContent.trim();
    if (!title || !content) return;

    if (mode === 'add') {
      addPromptTemplate({ title, content });
    } else if (mode === 'edit' && editTarget) {
      updatePromptTemplate(editTarget.id, { title, content });
    }
    setMode('list');
    setEditTarget(null);
    setFormTitle('');
    setFormContent('');
  };

  const handleDelete = (id) => {
    removePromptTemplate(id);
  };

  const handleFormCancel = () => {
    setMode('list');
    setEditTarget(null);
    setFormTitle('');
    setFormContent('');
  };

  // Filter templates by search query
  const filteredTemplates = searchQuery
    ? promptTemplates.filter(
        (t) =>
          t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : promptTemplates;

  const builtinTemplates = filteredTemplates.filter((t) => t.builtin);
  const customTemplates = filteredTemplates.filter((t) => !t.builtin);

  // Position the panel relative to the anchor button
  const panelStyle = {
    ...styles.panel,
  };

  return (
    <div ref={panelRef} style={panelStyle}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>
          {mode === 'list' ? 'Prompt 模板' : mode === 'add' ? '新建模板' : '编辑模板'}
        </span>
        {mode === 'list' && (
          <button style={styles.headerCloseBtn} onClick={onClose}>
            x
          </button>
        )}
        {mode !== 'list' && (
          <button style={styles.headerCloseBtn} onClick={handleFormCancel}>
            x
          </button>
        )}
      </div>

      {/* List mode */}
      {mode === 'list' && (
        <>
          {/* Search input */}
          <div style={styles.searchRow}>
            <input
              type="text"
              placeholder="搜索模板..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
              autoFocus
            />
          </div>

          {/* Template list */}
          <div style={styles.listContainer}>
            {builtinTemplates.length > 0 && (
              <>
                <div style={styles.sectionLabel}>内置模板</div>
                {builtinTemplates.map((template) => (
                  <TemplateItem
                    key={template.id}
                    template={template}
                    onSend={handleSend}
                    onEdit={undefined}
                    onDelete={undefined}
                  />
                ))}
              </>
            )}

            {customTemplates.length > 0 && (
              <>
                <div style={styles.sectionLabel}>自定义模板</div>
                {customTemplates.map((template) => (
                  <TemplateItem
                    key={template.id}
                    template={template}
                    onSend={handleSend}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </>
            )}

            {filteredTemplates.length === 0 && (
              <div style={styles.emptyState}>
                {searchQuery ? '没有匹配的模板' : '暂无自定义模板'}
              </div>
            )}
          </div>

          {/* Add button */}
          <div style={styles.footer}>
            <button style={styles.addBtn} onClick={handleAdd}>
              <span style={styles.addBtnIcon}>+</span>
              <span>新建模板</span>
            </button>
          </div>
        </>
      )}

      {/* Add / Edit form */}
      {(mode === 'add' || mode === 'edit') && (
        <form style={styles.form} onSubmit={handleFormSubmit}>
          <label style={styles.formLabel}>
            标题
            <input
              ref={titleInputRef}
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="例如：写个测试"
              style={styles.formInput}
              maxLength={50}
            />
          </label>
          <label style={styles.formLabel}>
            Prompt 内容
            <textarea
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder="例如：请为以下代码编写单元测试..."
              style={styles.formTextarea}
              rows={4}
              maxLength={500}
            />
          </label>
          <div style={styles.formActions}>
            <button type="button" style={styles.formCancelBtn} onClick={handleFormCancel}>
              取消
            </button>
            <button
              type="submit"
              style={{
                ...styles.formSubmitBtn,
                opacity: formTitle.trim() && formContent.trim() ? 1 : 0.4,
              }}
              disabled={!formTitle.trim() || !formContent.trim()}
            >
              {mode === 'add' ? '添加' : '保存'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Individual template row: title + preview + action buttons.
 */
function TemplateItem({ template, onSend, onEdit, onDelete }) {
  return (
    <div className="template-item" style={styles.templateItem} onClick={() => onSend(template)}>
      <div style={styles.templateItemMain}>
        <div style={styles.templateTitle}>
          {template.title}
          {template.builtin && <span style={styles.builtinBadge}>内置</span>}
        </div>
        <div style={styles.templatePreview} title={template.content}>
          {template.content}
        </div>
      </div>
      {!template.builtin && onEdit && (
        <div style={styles.templateActions}>
          <button
            className="template-action-btn"
            style={styles.templateActionBtn}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(template);
            }}
            title="编辑"
          >
            <PencilMiniIcon />
          </button>
          <button
            className="template-action-btn"
            style={styles.templateActionBtn}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(template.id);
            }}
            title="删除"
          >
            <TrashMiniIcon />
          </button>
        </div>
      )}
    </div>
  );
}

// Minimal inline pencil icon for the edit button
function PencilMiniIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

// Minimal inline trash icon for the delete button
function TrashMiniIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  panel: {
    position: 'absolute',
    top: '100%',
    right: 0,
    width: 320,
    maxHeight: 460,
    background: '#0d0d0d',
    border: '1px solid #1e1e1e',
    borderRadius: 8,
    boxShadow: '0 12px 40px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.4)',
    zIndex: 2000,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'var(--font-ui)',
    animation: 'fade-in 0.12s ease',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid #1a1a1a',
    background: '#0a0a0a',
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#e2e8f0',
    letterSpacing: '-0.005em',
  },
  headerCloseBtn: {
    background: 'none',
    border: 'none',
    color: '#555',
    fontSize: 14,
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1,
    fontWeight: 500,
    fontFamily: 'var(--font-mono)',
  },
  searchRow: {
    padding: '8px 12px',
    borderBottom: '1px solid #151515',
  },
  searchInput: {
    width: '100%',
    background: '#0a0a0a',
    border: '1px solid #222',
    borderRadius: 5,
    color: '#e2e8f0',
    fontSize: 12,
    padding: '6px 10px',
    outline: 'none',
    fontFamily: 'var(--font-ui)',
  },
  listContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 0',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: '#444',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '8px 14px 4px',
    fontFamily: 'var(--font-ui)',
  },
  templateItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    cursor: 'pointer',
    transition: 'background 0.12s',
    borderRadius: 4,
    margin: '0 6px',
  },
  templateItemMain: {
    flex: 1,
    minWidth: 0,
  },
  templateTitle: {
    fontSize: 12,
    fontWeight: 500,
    color: '#d0d0d0',
    marginBottom: 2,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  builtinBadge: {
    fontSize: 9,
    fontWeight: 600,
    color: '#555',
    background: '#161616',
    padding: '1px 5px',
    borderRadius: 3,
    letterSpacing: '0.04em',
  },
  templatePreview: {
    fontSize: 11,
    color: '#666',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    lineHeight: 1.4,
  },
  templateActions: {
    display: 'flex',
    gap: 2,
    flexShrink: 0,
  },
  templateActionBtn: {
    background: 'none',
    border: 'none',
    color: '#444',
    cursor: 'pointer',
    padding: '3px 4px',
    borderRadius: 3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.12s',
  },
  emptyState: {
    padding: '20px 14px',
    textAlign: 'center',
    fontSize: 12,
    color: '#444',
  },
  footer: {
    padding: '8px 12px',
    borderTop: '1px solid #1a1a1a',
    background: '#0a0a0a',
  },
  addBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '7px 0',
    background: '#111',
    border: '1px solid #222',
    borderRadius: 5,
    color: '#888',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontFamily: 'var(--font-ui)',
  },
  addBtnIcon: {
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1,
  },

  // Form styles
  form: {
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  formLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    fontSize: 11,
    fontWeight: 500,
    color: '#888',
    letterSpacing: '-0.005em',
  },
  formInput: {
    background: '#0a0a0a',
    border: '1px solid #222',
    borderRadius: 5,
    color: '#e2e8f0',
    fontSize: 12,
    padding: '7px 10px',
    outline: 'none',
    fontFamily: 'var(--font-ui)',
  },
  formTextarea: {
    background: '#0a0a0a',
    border: '1px solid #222',
    borderRadius: 5,
    color: '#e2e8f0',
    fontSize: 12,
    padding: '7px 10px',
    outline: 'none',
    fontFamily: 'var(--font-ui)',
    resize: 'vertical',
    minHeight: 80,
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  formCancelBtn: {
    background: '#151515',
    border: '1px solid #2a2a2a',
    borderRadius: 5,
    color: '#888',
    fontSize: 12,
    padding: '6px 16px',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    fontWeight: 500,
  },
  formSubmitBtn: {
    background: '#1a150a',
    border: '1px solid #3a2e0a',
    borderRadius: 5,
    color: '#f59e0b',
    fontSize: 12,
    padding: '6px 18px',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    fontWeight: 600,
  },
};
