import React, { useCallback, useRef } from 'react';
import { useSessionStore } from '../store/sessions';

/**
 * SplitContainer -- renders two TerminalView instances side by side or stacked.
 *
 * Props:
 *   primaryId      - session ID of the primary (left/top) pane
 *   secondaryId    - session ID of the secondary (right/bottom) pane
 *   direction      - 'horizontal' (left-right) or 'vertical' (top-bottom)
 *   ratio          - initial split ratio (0.2-0.8)
 *   renderTerminal - function(sessionId) => ReactNode (renders a TerminalView)
 */
export default function SplitContainer({ primaryId, secondaryId, direction, ratio, renderTerminal }) {
  const splitPane = useSessionStore((s) => s.splitPane);
  const setSplitRatio = useSessionStore((s) => s.setSplitRatio);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const isHorizontal = direction !== 'vertical';
  const currentRatio = splitPane?.ratio ?? ratio;

  // ── Drag handle for resizing split ────────────────────────────────────────
  const dragging = useRef(false);
  const containerRef = useRef(null);

  const onDividerMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;

    const startPos = isHorizontal ? e.clientX : e.clientY;
    const startRatio = currentRatio;
    const containerEl = containerRef.current;
    if (!containerEl) return;

    const totalSize = isHorizontal ? containerEl.offsetWidth : containerEl.offsetHeight;

    const onMouseMove = (ev) => {
      if (!dragging.current) return;
      const delta = (isHorizontal ? ev.clientX : ev.clientY) - startPos;
      const newRatio = startRatio + delta / totalSize;
      setSplitRatio(newRatio);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [isHorizontal, currentRatio, setSplitRatio]);

  // ── Focus management: click on a pane to make it active ───────────────────
  const handlePrimaryClick = useCallback(() => {
    if (activeSessionId !== primaryId) setActiveSession(primaryId);
  }, [activeSessionId, primaryId, setActiveSession]);

  const handleSecondaryClick = useCallback(() => {
    if (activeSessionId !== secondaryId) setActiveSession(secondaryId);
  }, [activeSessionId, secondaryId, setActiveSession]);

  const primaryPercent = `${(currentRatio * 100).toFixed(2)}%`;
  const secondaryPercent = `${((1 - currentRatio) * 100).toFixed(2)}%`;

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        flex: 1,
        overflow: 'hidden',
        height: '100%',
      }}
    >
      {/* Primary pane */}
      <div
        style={{
          flexBasis: primaryPercent,
          flexGrow: 0,
          flexShrink: 1,
          overflow: 'hidden',
          outline: activeSessionId === primaryId ? '1px solid #2a2a2a' : '1px solid transparent',
          outlineOffset: -1,
          minWidth: isHorizontal ? 250 : 0,
          minHeight: isHorizontal ? 0 : 200,
        }}
        onClick={handlePrimaryClick}
      >
        {renderTerminal(primaryId)}
      </div>

      {/* Drag handle / divider */}
      <div
        onMouseDown={onDividerMouseDown}
        className="split-divider"
        style={{
          flexShrink: 0,
          width: isHorizontal ? 5 : '100%',
          height: isHorizontal ? '100%' : 5,
          background: '#1a1a1a',
          cursor: isHorizontal ? 'col-resize' : 'row-resize',
          position: 'relative',
          zIndex: 10,
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a2a'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '#1a1a1a'; }}
      />

      {/* Secondary pane */}
      <div
        style={{
          flex: 1,
          overflow: 'hidden',
          outline: activeSessionId === secondaryId ? '1px solid #2a2a2a' : '1px solid transparent',
          outlineOffset: -1,
          minWidth: isHorizontal ? 250 : 0,
          minHeight: isHorizontal ? 0 : 200,
        }}
        onClick={handleSecondaryClick}
      >
        {renderTerminal(secondaryId)}
      </div>
    </div>
  );
}
