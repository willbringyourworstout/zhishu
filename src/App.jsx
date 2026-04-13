import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import TerminalView from './components/TerminalView';
import SplitContainer from './components/SplitContainer';
import ToastStack from './components/ToastStack';
import SettingsModal from './components/SettingsModal';
import PromptDialog from './components/PromptDialog';
import { useSessionStore } from './store/sessions';
import { playNotificationSound } from './utils/sound';

export default function App() {
  const mainRef = useRef(null);
  const {
    init, isLoading, projects, activeSessionId,
    yoloMode, toggleYoloMode,
    notificationsEnabled, toggleNotifications,
    sessionStatus, updateSessionStatus,
    toasts, addToast, removeToast,
    setActiveSession,
    addSessionToActiveProject, closeActiveSession, setSessionByIndex,
    splitPane, openSplit, closeSplit, swapSplitSessions,
  } = useSessionStore();

  // Single global 5s tick replacing N per-component 1s intervals.
  // Both Sidebar (SessionRow) and TerminalView consume `now` from the store.
  const tickNow = useSessionStore((s) => s.tickNow);
  useEffect(() => {
    const t = setInterval(tickNow, 5000);
    return () => clearInterval(t);
  }, [tickNow]);

  useEffect(() => { init(); }, [init]);

  // ── Global keyboard shortcuts ─────────────────────────────────────────
  // Cmd+T → new session, Cmd+W → close session, Cmd+1..9 → jump to Nth
  // Cmd+\ → toggle split, Cmd+Shift+\ → swap split sessions
  // We use { capture: true } so xterm.js doesn't swallow the keys first.
  useEffect(() => {
    const handler = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;

      // Cmd+T → new session
      if ((e.key === 't' || e.key === 'T') && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        addSessionToActiveProject();
        return;
      }
      // Cmd+W → close current session
      if ((e.key === 'w' || e.key === 'W') && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        closeActiveSession();
        return;
      }
      // Cmd+1..9 → jump to Nth session (across all projects)
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        setSessionByIndex(parseInt(e.key, 10) - 1);
        return;
      }
      // Cmd+Shift+\ → swap split sessions
      if (e.key === '\\' && e.shiftKey) {
        e.preventDefault();
        swapSplitSessions();
        return;
      }
      // Cmd+\ → toggle split (open with next session or close)
      if (e.key === '\\' && !e.shiftKey) {
        e.preventDefault();
        if (splitPane) {
          closeSplit();
        } else {
          // Find the next session that is not the active one
          const allSessions = projects.flatMap((p) => p.sessions.map((s) => s.id));
          const nextSession = allSessions.find((id) => id !== activeSessionId);
          if (nextSession) openSplit(nextSession);
        }
        return;
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [addSessionToActiveProject, closeActiveSession, setSessionByIndex, splitPane, closeSplit, openSplit, swapSplitSessions, projects, activeSessionId]);

  // Subscribe to per-session status updates (busy/idle phase changes)
  // Uses diff algorithm: only subscribe new sessions, only unsubscribe removed ones.
  const sessionSubs = useRef(new Map()); // sessionId -> unsubscribe fn
  useEffect(() => {
    const currentIds = new Set(
      projects.flatMap((p) => p.sessions.map((s) => s.id))
    );
    const prev = sessionSubs.current;

    // Unsubscribe removed sessions
    for (const [id, unsub] of prev) {
      if (!currentIds.has(id)) {
        unsub?.();
        prev.delete(id);
      }
    }

    // Subscribe new sessions
    for (const id of currentIds) {
      if (!prev.has(id)) {
        const unsub = window.electronAPI.onSessionStatus(id, (status) => {
          updateSessionStatus(id, status);
        });
        prev.set(id, unsub);
      }
    }
  }, [projects, updateSessionStatus]);

  // Cleanup all session subscriptions on unmount
  useEffect(() => {
    return () => {
      for (const [, unsub] of sessionSubs.current) {
        unsub?.();
      }
      sessionSubs.current.clear();
    };
  }, []);

  // Global subscription: AI response-complete events → toast + sound
  // This is the key "awareness" mechanism — fires every time an AI finishes
  // generating a response (busy → idle transition), NOT just on process exit.
  useEffect(() => {
    const unsub = window.electronAPI.onResponseComplete((payload) => {
      addToast({
        sessionId: payload.sessionId,
        tool: payload.tool,
        toolLabel: payload.toolLabel,
        sessionName: payload.sessionName,
        duration: payload.duration,
      });

      // Play the in-app chime whenever notifications are enabled
      if (notificationsEnabled) {
        playNotificationSound();
      }
    });
    return () => unsub?.();
  }, [addToast, notificationsEnabled]);

  // ── Build session lookup (sessionId -> { project, session }) ────────────
  const sessionMap = useMemo(() => {
    const map = new Map();
    for (const p of projects) {
      for (const s of p.sessions) {
        map.set(s.id, { project: p, session: s });
      }
    }
    return map;
  }, [projects]);

  // Render a single TerminalView for a given session ID.
  // When `inSplit` is true the terminal relaxes its minWidth so panes can
  // shrink down to 350px (normal single-view minWidth is 400px).
  const renderTerminal = useCallback((sid, { inSplit = false } = {}) => {
    const entry = sessionMap.get(sid);
    if (!entry) return null;
    const { project: p, session: s } = entry;
    return (
      <TerminalView
        sessionId={s.id}
        cwd={p.path}
        yoloMode={yoloMode}
        onYoloToggle={toggleYoloMode}
        sessionCreatedAt={s.createdAt}
        sessionStatus={sessionStatus[s.id]}
        notificationsEnabled={notificationsEnabled}
        onNotificationsToggle={toggleNotifications}
        sessionLastTool={s.lastTool}
        isActive={s.id === activeSessionId}
        splitMode={inSplit}
      />
    );
  }, [sessionMap, yoloMode, toggleYoloMode, sessionStatus, notificationsEnabled, toggleNotifications, activeSessionId]);

  // Determine which sessions are in the split (if any) so we can exclude them
  // from the background termStack.
  const splitSessionIds = useMemo(() => {
    if (!splitPane) return new Set();
    return new Set([activeSessionId, splitPane.sessionId]);
  }, [splitPane, activeSessionId]);

  // ── Auto-close split when main area becomes too narrow ──────────────────
  // Each pane needs at least 350px. If the main area drops below 700px the
  // split becomes unusable, so we close it automatically.
  // Uses ResizeObserver on the <main> element so Sidebar drag-resize also
  // triggers the check (window resize only fires on actual window changes).
  useEffect(() => {
    if (!splitPane || !mainRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      if (width < 700) {
        closeSplit();
      }
    });
    observer.observe(mainRef.current);
    return () => observer.disconnect();
  }, [splitPane, closeSplit]);

  // ── Drop handler for sidebar session drag → open split ──────────────────
  const handleMainDrop = useCallback((e) => {
    const draggedId = e.dataTransfer.getData('application/x-zhishu-session');
    if (draggedId && draggedId !== activeSessionId) {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.classList?.remove('split-drop-zone-active');
      openSplit(draggedId);
    }
  }, [activeSessionId, openSplit]);

  const handleMainDragOver = useCallback((e) => {
    if (e.dataTransfer.types.includes('application/x-zhishu-session')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      e.currentTarget.classList.add('split-drop-zone-active');
    }
  }, []);

  const handleMainDragLeave = useCallback((e) => {
    e.currentTarget.classList.remove('split-drop-zone-active');
  }, []);

  if (isLoading) {
    return (
      <div style={styles.loading}>
        <span style={styles.loadingDot}>▣</span>
        <span style={{ color: '#555', fontSize: 12, fontFamily: 'monospace', marginTop: 12 }}>
          Initializing...
        </span>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <Sidebar />
      <main
        ref={mainRef}
        style={styles.main}
        onDrop={handleMainDrop}
        onDragOver={handleMainDragOver}
        onDragLeave={handleMainDragLeave}
      >
        {activeSessionId ? (
          <>
            {/* SplitContainer: renders the two split sessions independently */}
            {splitPane && splitSessionIds.size === 2 && (
              <SplitContainer
                primaryId={activeSessionId}
                secondaryId={splitPane.sessionId}
                direction={splitPane.direction}
                ratio={splitPane.ratio}
                renderTerminal={(sid) => renderTerminal(sid, { inSplit: true })}
              />
            )}
            {/* Background termStack: non-split sessions only.
                When split is active, the two split sessions are NOT rendered here
                at all — they render exclusively inside SplitContainer. This prevents
                double-mounting two TerminalView instances for the same session, which
                would cause duplicate IPC subscriptions and competing resize calls.
                Non-split sessions remain mounted (visibility toggled) for xterm.js
                dimension stability. */}
            <div style={{
              ...styles.termStack,
              ...(splitPane ? { position: 'absolute', pointerEvents: 'none' } : {}),
            }}>
              {projects.flatMap((p) =>
                p.sessions.map((s) => {
                  const isSplitParticipant = splitPane && splitSessionIds.has(s.id);
                  const isVisible = !splitPane
                    ? s.id === activeSessionId
                    : !isSplitParticipant && s.id === activeSessionId;

                  return (
                    <div
                      key={s.id}
                      style={{
                        ...styles.termLayer,
                        visibility: isVisible ? 'visible' : 'hidden',
                        zIndex: isVisible ? 1 : 0,
                      }}
                    >
                      {isSplitParticipant ? null : (
                        <TerminalView
                          sessionId={s.id}
                          cwd={p.path}
                          yoloMode={yoloMode}
                          onYoloToggle={toggleYoloMode}
                          sessionCreatedAt={s.createdAt}
                          sessionStatus={sessionStatus[s.id]}
                          notificationsEnabled={notificationsEnabled}
                          onNotificationsToggle={toggleNotifications}
                          sessionLastTool={s.lastTool}
                          isActive={s.id === activeSessionId}
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>▣</div>
            <p style={styles.emptyTitle}>AI Terminal Manager</p>
            <p style={styles.emptyHint}>在左侧添加项目，创建会话，即可开始</p>
          </div>
        )}
      </main>

      {/* Floating in-app notifications (response-complete toasts) */}
      <ToastStack
        toasts={toasts}
        onDismiss={removeToast}
        onNavigate={(sessionId) => setActiveSession(sessionId)}
      />

      {/* Settings modal — only mounted when open */}
      <SettingsModal />

      {/* Custom prompt dialog (replaces window.prompt which Electron blocks) */}
      <PromptDialog />
    </div>
  );
}

const styles = {
  root: {
    display: 'flex',
    height: '100vh',
    background: '#0a0a0a',
    fontFamily: 'system-ui, -apple-system',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: '#0d0d0d',
    position: 'relative',
  },
  termStack: {
    position: 'relative',
    flex: 1,
    overflow: 'hidden',
  },
  termLayer: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#0a0a0a',
  },
  loadingDot: {
    fontSize: 28,
    color: '#f59e0b',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: 12,
  },
  emptyIcon: {
    fontSize: 40,
    color: '#1e1e1e',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#2a2a2a',
    letterSpacing: '-0.02em',
  },
  emptyHint: {
    fontSize: 13,
    color: '#1e1e1e',
  },
};
