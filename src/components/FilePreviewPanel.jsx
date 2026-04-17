import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSessionStore } from '../store/sessions';

// ─── FilePreviewPanel — right-side preview panel ──────────────────────────────
//
// T2: Mid-tier preview implementation
// Supports: image / markdown / plain text / binary fallback / large file fallback

// ── File type resolution ──────────────────────────────────────────────────────

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
const MARKDOWN_EXTS = ['.md', '.mdx'];

function getFileType(name) {
  if (!name) return 'text';
  const ext = '.' + name.split('.').pop().toLowerCase();
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (MARKDOWN_EXTS.includes(ext)) return 'markdown';
  return 'text';
}

// ── Binary detection (check first 512 bytes for null byte) ───────────────────

function isBinary(content) {
  if (!content || typeof content !== 'string') return false;
  const sample = content.slice(0, 512);
  return sample.indexOf('\u0000') !== -1;
}

// ── Loading spinner ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={styles.spinnerWrapper}>
      <div style={styles.spinner} />
      <span style={styles.spinnerText}>加载中...</span>
    </div>
  );
}

// ── Fallback view (binary / large file / error) ───────────────────────────────

function FallbackView({ message, filePath }) {
  const revealInFinder = useCallback(() => {
    if (filePath) window.electronAPI.revealInFinder(filePath);
  }, [filePath]);

  const openWithDefault = useCallback(() => {
    if (filePath) window.electronAPI.openFile(filePath);
  }, [filePath]);

  return (
    <div style={styles.fallback}>
      <div style={styles.fallbackIcon}>◫</div>
      <p style={styles.fallbackText}>{message}</p>
      <div style={styles.fallbackButtons}>
        <button
          style={styles.fallbackBtn}
          onClick={revealInFinder}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#1e1e1e'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          在 Finder 中显示
        </button>
        <button
          style={{ ...styles.fallbackBtn, ...styles.fallbackBtnPrimary }}
          onClick={openWithDefault}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          用默认应用打开
        </button>
      </div>
    </div>
  );
}

// ── Image view ────────────────────────────────────────────────────────────────

function ImageView({ filePath, fileName, onError }) {
  const [imgError, setImgError] = useState(false);

  const handleError = useCallback(() => {
    setImgError(true);
    if (onError) onError('图片加载失败');
  }, [onError]);

  if (imgError) {
    return <FallbackView message="图片加载失败" filePath={filePath} />;
  }

  // Encode each path segment individually so '#' and '?' in filenames don't
  // get interpreted as URL fragment/query separators (encodeURI leaves them).
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');

  return (
    <div style={styles.imageWrapper}>
      <img
        src={`file://${encodedPath}`}
        alt={fileName}
        style={styles.image}
        onError={handleError}
      />
    </div>
  );
}

// ── Markdown view ─────────────────────────────────────────────────────────────

function MarkdownView({ content }) {
  // Prevent link navigation inside Electron renderer
  const handleLinkClick = useCallback((e) => {
    e.preventDefault();
  }, []);

  return (
    <div style={styles.markdownScroll}>
      <div style={styles.markdownBody}>
        <ReactMarkdown
          components={{
            a: (props) => (
              <a
                {...props}
                style={styles.mdLink}
                onClick={handleLinkClick}
                href={props.href}
              />
            ),
            h1: (props) => <h1 style={styles.mdH1} {...props} />,
            h2: (props) => <h2 style={styles.mdH2} {...props} />,
            h3: (props) => <h3 style={styles.mdH3} {...props} />,
            h4: (props) => <h4 style={styles.mdH4} {...props} />,
            p: (props) => <p style={styles.mdP} {...props} />,
            ul: (props) => <ul style={styles.mdUl} {...props} />,
            ol: (props) => <ol style={styles.mdOl} {...props} />,
            li: (props) => <li style={styles.mdLi} {...props} />,
            blockquote: (props) => (
              <blockquote style={styles.mdBlockquote} {...props} />
            ),
            code: ({ className, children, ...props }) => {
              // react-markdown v10 removed the `inline` prop. Distinguish
              // inline vs block by presence of className (language-xxx on fenced blocks).
              const isBlock = Boolean(className);
              if (!isBlock) {
                return <code style={styles.mdInlineCode}>{children}</code>;
              }
              return (
                <pre style={styles.mdPre}>
                  <code style={styles.mdCode} className={className}>{children}</code>
                </pre>
              );
            },
            pre: (props) => {
              // When react-markdown wraps code blocks in pre, it calls the code renderer above.
              // We pass-through here to avoid double-wrapping.
              return <>{props.children}</>;
            },
            hr: (props) => <hr style={styles.mdHr} {...props} />,
            strong: (props) => (
              <strong style={styles.mdStrong} {...props} />
            ),
            em: (props) => <em style={styles.mdEm} {...props} />,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

// ── Plain text view ───────────────────────────────────────────────────────────

function PlainTextView({ content }) {
  return (
    <div style={styles.textScroll}>
      <pre style={styles.textPre}>{content}</pre>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FilePreviewPanel() {
  const previewPanelOpen = useSessionStore((s) => s.previewPanelOpen);
  const filePreview = useSessionStore((s) => s.filePreview);
  const closeFilePreview = useSessionStore((s) => s.closeFilePreview);
  const previewPanelWidth = useSessionStore((s) => s.previewPanelWidth);
  const setPanelWidth = useSessionStore((s) => s.setPanelWidth);
  const commitPanelWidth = useSessionStore((s) => s.commitPanelWidth);

  const [isResizing, setIsResizing] = useState(false);

  // Content state
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fileType, setFileType] = useState('text');

  // Track the path we last started loading so stale responses don't overwrite
  const loadingPathRef = useRef(null);

  // ── Load content when file path changes ────────────────────────────────────
  useEffect(() => {
    if (!filePreview?.path) {
      setContent(null);
      setError(null);
      setLoading(false);
      return;
    }

    const type = getFileType(filePreview.name);
    setFileType(type);

    // Images don't need IPC read — rendered via file:// URL directly
    if (type === 'image') {
      setContent(null);
      setError(null);
      setLoading(false);
      return;
    }

    // Reset state before loading
    setContent(null);
    setError(null);
    setLoading(true);

    const currentPath = filePreview.path;
    loadingPathRef.current = currentPath;

    window.electronAPI.readFilePreview(currentPath).then((result) => {
      // Discard stale response if path has changed
      if (loadingPathRef.current !== currentPath) return;

      setLoading(false);

      if (result.error) {
        if (result.error.startsWith('File too large')) {
          setError('file_too_large');
        } else {
          setError(result.error);
        }
        return;
      }

      if (isBinary(result.content)) {
        setError('binary');
        return;
      }

      setContent(result.content);
    }).catch((err) => {
      if (loadingPathRef.current !== currentPath) return;
      setLoading(false);
      setError(err?.message || '读取失败');
    });
  }, [filePreview?.path, filePreview?.name]);

  // ── Left-edge resizer ──────────────────────────────────────────────────────
  const onResizerMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = previewPanelWidth;

    const onMouseMove = (moveEvent) => {
      const deltaX = startX - moveEvent.clientX;
      setPanelWidth('preview', startWidth + deltaX);
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
  }, [previewPanelWidth, setPanelWidth, commitPanelWidth]);

  if (!previewPanelOpen) return null;

  // ── Render body content ────────────────────────────────────────────────────
  const renderBody = () => {
    if (!filePreview) {
      return (
        <div style={styles.placeholderWrapper}>
          <div style={styles.placeholderIcon}>◫</div>
          <p style={styles.placeholderTitle}>选择文件以预览</p>
        </div>
      );
    }

    if (loading) {
      return <Spinner />;
    }

    // Error states
    if (error === 'binary') {
      return (
        <FallbackView
          message="二进制文件，不支持文本预览"
          filePath={filePreview.path}
        />
      );
    }

    if (error === 'file_too_large') {
      return (
        <FallbackView
          message="文件过大（超过 1MB），不支持预览"
          filePath={filePreview.path}
        />
      );
    }

    if (error) {
      return (
        <FallbackView
          message={`预览失败：${error}`}
          filePath={filePreview.path}
        />
      );
    }

    // Image type renders via file:// URL, no content needed
    if (fileType === 'image') {
      return (
        <ImageView
          filePath={filePreview.path}
          fileName={filePreview.name}
        />
      );
    }

    if (content === null) {
      return (
        <div style={styles.placeholderWrapper}>
          <div style={styles.placeholderIcon}>◫</div>
          <p style={styles.placeholderTitle}>暂无内容</p>
        </div>
      );
    }

    if (fileType === 'markdown') {
      return <MarkdownView content={content} />;
    }

    // Plain text (including unknown extensions that aren't binary)
    return <PlainTextView content={content} />;
  };

  return (
    <div
      style={{
        ...styles.panel,
        width: previewPanelWidth,
        transition: isResizing ? 'none' : 'width 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
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
          <span style={styles.headerTitle}>预览</span>
          {filePreview?.name && (
            <span style={styles.fileName} title={filePreview.path}>
              {filePreview.name}
            </span>
          )}
        </div>
        <button
          style={styles.iconBtn}
          onClick={closeFilePreview}
          title="关闭预览"
          onMouseEnter={(e) => { e.currentTarget.style.color = '#aaa'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#555'; }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={styles.body}>
        {renderBody()}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
    minWidth: 0,
    flex: 1,
    overflow: 'hidden',
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#d0d0d0',
    fontFamily: 'var(--font-ui)',
    letterSpacing: '-0.005em',
    flexShrink: 0,
  },
  fileName: {
    fontSize: 11,
    color: '#888',
    fontFamily: 'var(--font-mono)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    minWidth: 0,
  },
  iconBtn: {
    background: 'transparent',
    border: 'none',
    color: '#555',
    fontSize: 16,
    cursor: 'pointer',
    width: 22,
    height: 22,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 3,
    padding: 0,
    lineHeight: 1,
    flexShrink: 0,
    transition: 'color 0.15s',
  },
  body: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },

  // ── Loading spinner ─────────────────────────────────────────────────────────
  spinnerWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 12,
  },
  spinner: {
    width: 20,
    height: 20,
    border: '2px solid #1e1e1e',
    borderTop: '2px solid #555',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  spinnerText: {
    fontSize: 11,
    color: '#444',
    fontFamily: 'var(--font-ui)',
  },

  // ── Placeholder ─────────────────────────────────────────────────────────────
  placeholderWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: '40px 20px',
    gap: 10,
  },
  placeholderIcon: {
    fontSize: 32,
    color: '#2a2a2a',
  },
  placeholderTitle: {
    fontSize: 12,
    color: '#444',
    fontFamily: 'var(--font-ui)',
    margin: 0,
  },

  // ── Fallback (binary / large / error) ──────────────────────────────────────
  fallback: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: '40px 24px',
    gap: 12,
  },
  fallbackIcon: {
    fontSize: 28,
    color: '#333',
  },
  fallbackText: {
    fontSize: 12,
    color: '#555',
    fontFamily: 'var(--font-ui)',
    margin: 0,
    textAlign: 'center',
    lineHeight: 1.6,
    maxWidth: 220,
  },
  fallbackButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    width: '100%',
    maxWidth: 200,
    marginTop: 4,
  },
  fallbackBtn: {
    background: 'transparent',
    border: '1px solid #222',
    color: '#888',
    fontSize: 11,
    fontFamily: 'var(--font-ui)',
    cursor: 'pointer',
    padding: '6px 12px',
    borderRadius: 4,
    textAlign: 'center',
    transition: 'background 0.15s',
  },
  fallbackBtnPrimary: {
    background: '#141414',
    borderColor: '#2a2a2a',
    color: '#bbb',
  },

  // ── Image ───────────────────────────────────────────────────────────────────
  imageWrapper: {
    flex: 1,
    overflow: 'auto',
    padding: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    display: 'block',
    margin: '0 auto',
  },

  // ── Plain text ──────────────────────────────────────────────────────────────
  textScroll: {
    flex: 1,
    overflow: 'auto',
    padding: '14px 16px',
  },
  textPre: {
    margin: 0,
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    lineHeight: 1.65,
    color: '#b0b0b0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    tabSize: 2,
  },

  // ── Markdown scroll container ───────────────────────────────────────────────
  markdownScroll: {
    flex: 1,
    overflow: 'auto',
    padding: '16px 20px',
  },
  markdownBody: {
    maxWidth: '100%',
    color: '#c0c0c0',
    fontFamily: 'var(--font-ui)',
    fontSize: 13,
    lineHeight: 1.7,
  },

  // ── Markdown element styles (applied via ReactMarkdown components prop) ──────
  mdH1: {
    fontSize: 20,
    fontWeight: 700,
    color: '#e0e0e0',
    margin: '0 0 16px 0',
    paddingBottom: 8,
    borderBottom: '1px solid #1e1e1e',
    lineHeight: 1.3,
    fontFamily: 'var(--font-ui)',
  },
  mdH2: {
    fontSize: 16,
    fontWeight: 600,
    color: '#d5d5d5',
    margin: '24px 0 12px 0',
    paddingBottom: 6,
    borderBottom: '1px solid #181818',
    lineHeight: 1.35,
    fontFamily: 'var(--font-ui)',
  },
  mdH3: {
    fontSize: 14,
    fontWeight: 600,
    color: '#c8c8c8',
    margin: '20px 0 8px 0',
    lineHeight: 1.4,
    fontFamily: 'var(--font-ui)',
  },
  mdH4: {
    fontSize: 13,
    fontWeight: 600,
    color: '#bcbcbc',
    margin: '16px 0 6px 0',
    lineHeight: 1.4,
    fontFamily: 'var(--font-ui)',
  },
  mdP: {
    margin: '0 0 12px 0',
    lineHeight: 1.7,
    color: '#b8b8b8',
  },
  mdUl: {
    margin: '0 0 12px 0',
    paddingLeft: 20,
    color: '#b0b0b0',
  },
  mdOl: {
    margin: '0 0 12px 0',
    paddingLeft: 20,
    color: '#b0b0b0',
  },
  mdLi: {
    marginBottom: 4,
    lineHeight: 1.6,
  },
  mdBlockquote: {
    margin: '0 0 12px 0',
    padding: '4px 12px',
    borderLeft: '3px solid #2a2a2a',
    color: '#787878',
    fontStyle: 'italic',
  },
  mdInlineCode: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    background: '#141414',
    color: '#c8956a',
    padding: '1px 5px',
    borderRadius: 3,
    border: '1px solid #1e1e1e',
  },
  mdPre: {
    margin: '0 0 14px 0',
    padding: '12px 14px',
    background: '#0e0e0e',
    border: '1px solid #1c1c1c',
    borderRadius: 5,
    overflow: 'auto',
  },
  mdCode: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    color: '#a0c0a0',
    lineHeight: 1.6,
    display: 'block',
    whiteSpace: 'pre',
  },
  mdLink: {
    color: '#6b9fd4',
    textDecoration: 'none',
    cursor: 'default',
  },
  mdHr: {
    border: 'none',
    borderTop: '1px solid #1e1e1e',
    margin: '20px 0',
  },
  mdStrong: {
    fontWeight: 600,
    color: '#d0d0d0',
  },
  mdEm: {
    fontStyle: 'italic',
    color: '#a8a8a8',
  },
};

// ── Inject spinner keyframe animation ─────────────────────────────────────────
// React doesn't support @keyframes in inline styles, so we inject once into <head>.
if (typeof document !== 'undefined') {
  const SPIN_STYLE_ID = 'file-preview-spin-keyframe';
  if (!document.getElementById(SPIN_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = SPIN_STYLE_ID;
    style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(style);
  }
}
