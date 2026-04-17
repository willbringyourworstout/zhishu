/**
 * Process monitor module.
 *
 * Implements the four-state FSM that watches AI tool processes:
 *   not_started -> idle_no_instruction -> running -> awaiting_review
 *
 * Uses a 1.5s BFS tick over the system process table to detect which
 * AI tools are active in each session's pty tree.
 */

const { BrowserWindow, Notification } = require('electron');
const { execFile } = require('child_process');
const {
  ptyProcesses,
  ptyMeta,
  sessionStatus,
  sessionLaunchedTool,
  notifyTimers,
  sessionNames,
  broadcastStatus,
  broadcastResponseComplete,
  isNotificationsEnabled,
  cleanupSession,
} = require('./pty');
const { TOOL_CATALOG } = require('./tools');

// Silence threshold (ms) after which we consider an AI tool "done responding".
const IDLE_SILENCE_MS = 3000;

// Debounce for "response complete" notifications.
const NOTIFY_DEBOUNCE_MS = 3500;

// Known AI CLI tools — dynamically generated from TOOL_CATALOG so that
// adding a new tool in tools.js automatically creates a matcher here.
// NOTE: If you need a custom regex (e.g. to avoid false positives), add a
// `matchRegex` field to the tool entry in TOOL_CATALOG and this builder
// will pick it up.
const AI_TOOL_MATCHERS = Object.values(TOOL_CATALOG).map((tool) => ({
  id: tool.id,
  label: tool.name,
  regex: new RegExp(`(^|\\/|\\s)${tool.command}(\\s|$)`),
}));

// maxBuffer for ps output — increased from 8MB to 32MB to handle machines
// with very large process tables (CI servers, Docker hosts).
const PS_MAX_BUFFER = 32 * 1024 * 1024;

function snapshotProcesses() {
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'pid=,ppid=,command='],
      { maxBuffer: PS_MAX_BUFFER },
      (err, stdout) => {
        // Node.js throws 'maxBuffer exceeded' when output exceeds the limit.
        // Return an empty snapshot so monitorTick skips this tick gracefully.
        if (err) {
          if (err.message && err.message.includes('maxBuffer')) {
            console.warn(
              `[monitor] ps output exceeded ${PS_MAX_BUFFER / (1024 * 1024)}MB; ` +
              'process snapshot truncated. Consider further increasing PS_MAX_BUFFER.'
            );
          } else {
            console.warn('[monitor] ps command failed:', err.message);
          }
          return resolve({ ok: false, byPpid: new Map(), byPid: new Map() });
        }

        // Truncation detection: if output length is within 5% of maxBuffer,
        // the snapshot may be incomplete. Log a warning but still parse what we got.
        if (stdout.length > PS_MAX_BUFFER * 0.95) {
          console.warn(
            `[monitor] ps output (${Math.round(stdout.length / (1024 * 1024))}MB) ` +
            `is near maxBuffer limit (${PS_MAX_BUFFER / (1024 * 1024)}MB); ` +
            'some processes may be missing from snapshot.'
          );
        }

        const byPpid = new Map();
        const byPid = new Map();
        const lines = stdout.split('\n');

        for (const line of lines) {
          const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
          if (!m) continue;
          const proc = { pid: +m[1], ppid: +m[2], command: m[3] };
          byPid.set(proc.pid, proc);
          if (!byPpid.has(proc.ppid)) byPpid.set(proc.ppid, []);
          byPpid.get(proc.ppid).push(proc);
        }
        resolve({ ok: true, byPpid, byPid });
      });
  });
}

function findActiveAITool(shellPid, byPpid) {
  const visited = new Set();
  const queue = [shellPid];

  while (queue.length) {
    const pid = queue.shift();
    if (visited.has(pid)) continue;
    visited.add(pid);

    const children = byPpid.get(pid) || [];
    for (const child of children) {
      for (const tool of AI_TOOL_MATCHERS) {
        if (tool.regex.test(child.command)) {
          return tool;
        }
      }
      queue.push(child.pid);
    }
  }
  return null;
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function sendCompletionNotification(sessionName, tool, duration) {
  if (!isNotificationsEnabled() || !Notification.isSupported()) return;

  try {
    const notif = new Notification({
      title: `${tool.label} 响应完成`,
      body: `${sessionName} · 耗时 ${formatDuration(duration)} · 点击查看`,
      silent: false,
      sound: 'Glass',
    });

    notif.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });

    notif.show();
  } catch (e) {
    console.error('Failed to show notification:', e);
  }
}

function computePhase({ hasUserInput, isOutputting }) {
  if (!hasUserInput) return 'idle_no_instruction';
  return isOutputting ? 'running' : 'awaiting_review';
}

async function monitorTick() {
  if (ptyProcesses.size === 0) return;

  const { ok, byPpid } = await snapshotProcesses();
  if (!ok) return;
  const now = Date.now();

  for (const [sessionId, ptyProc] of ptyProcesses) {
    let activeTool = findActiveAITool(ptyProc.pid, byPpid);

    // Disambiguate claude vs providers that reuse the claude binary (GLM/MiniMax/Kimi/QwenCP/…)
    // Any declared intent that isn't 'claude' itself wins over the raw process scan result.
    if (activeTool && activeTool.id === 'claude') {
      const declared = sessionLaunchedTool.get(sessionId);
      if (declared && declared.id !== 'claude') {
        activeTool = { id: declared.id, label: declared.label };
      }
    }

    const prev = sessionStatus.get(sessionId) || {
      tool: null, phase: 'not_started', startedAt: null, runningStartedAt: null,
    };
    const meta = ptyMeta.get(sessionId);

    // CASE 1: AI tool is present in the process tree
    if (activeTool) {
      const silenceMs = meta ? now - meta.lastOutputAt : Infinity;
      const isOutputting = silenceMs < IDLE_SILENCE_MS;
      const hasUserInput = !!meta?.hasUserInput;
      const phase = computePhase({ hasUserInput, isOutputting });

      if (!prev.tool || prev.tool !== activeTool.id) {
        const next = {
          tool: activeTool.id,
          label: activeTool.label,
          phase,
          startedAt: now,
          runningStartedAt: phase === 'running' ? now : null,
        };
        sessionStatus.set(sessionId, next);
        broadcastStatus(sessionId, next);
      } else if (prev.phase !== phase) {
        const next = {
          ...prev,
          phase,
          runningStartedAt: phase === 'running' ? now : prev.runningStartedAt,
        };
        sessionStatus.set(sessionId, next);
        broadcastStatus(sessionId, next);

        // Transition A: running -> awaiting_review — schedule debounced notification
        if (prev.phase === 'running' && phase === 'awaiting_review' && prev.runningStartedAt) {
          const responseDuration = now - prev.runningStartedAt;

          const existing = notifyTimers.get(sessionId);
          if (existing) clearTimeout(existing);

          if (responseDuration >= 2000) {
            const capturedTool = activeTool;
            const capturedSessionId = sessionId;
            const capturedDuration = responseDuration;

            const timer = setTimeout(() => {
              notifyTimers.delete(capturedSessionId);
              const current = sessionStatus.get(capturedSessionId);
              if (current?.phase !== 'awaiting_review') return;

              broadcastResponseComplete(capturedSessionId, capturedTool, capturedDuration);
              const sName = sessionNames.get(capturedSessionId) || 'Session';
              sendCompletionNotification(sName, capturedTool, capturedDuration);
            }, NOTIFY_DEBOUNCE_MS);

            notifyTimers.set(sessionId, timer);
          }
        }

        // Transition B: awaiting_review -> running (AI resumed) — cancel pending notification
        if (prev.phase === 'awaiting_review' && phase === 'running') {
          const pending = notifyTimers.get(sessionId);
          if (pending) {
            clearTimeout(pending);
            notifyTimers.delete(sessionId);
          }
        }
      }
    }
    // CASE 2: AI tool fully exited
    // Uses cleanupSession() which is the same function called by the pty
    // onExit handler.  The call is idempotent — if onExit already cleaned
    // up, this is a no-op because sessionStatus no longer has .tool set.
    else if (prev.tool) {
      cleanupSession(sessionId);

      if (meta) meta.hasUserInput = false;
    }
  }
}

/**
 * Called by hookWatcher when a Claude Code Stop hook signal arrives.
 * Fires an immediate "response complete" notification, bypassing the
 * polling-based 3.5s debounce — much more accurate than silence detection.
 *
 * @param {string} sessionId  The session UUID extracted from the signal file name.
 */
function handleHookStop(sessionId) {
  const now    = Date.now();
  const status = sessionStatus.get(sessionId);

  // Guard: only act if this session was actually running
  if (!status && !sessionLaunchedTool.get(sessionId)) return;

  // Resolve the tool identity (prefer live status, fall back to launched map)
  const toolId    = status?.tool || status?.lastRanTool || sessionLaunchedTool.get(sessionId)?.id;
  const toolLabel = status?.label || sessionLaunchedTool.get(sessionId)?.label || toolId;
  if (!toolId) return;

  // Cancel any pending polling-based debounce timer — hook wins
  const pending = notifyTimers.get(sessionId);
  if (pending) {
    clearTimeout(pending);
    notifyTimers.delete(sessionId);
  }

  // Calculate response duration
  const runningStartedAt = status?.runningStartedAt;
  const duration = runningStartedAt ? now - runningStartedAt : 0;

  // Ignore sub-2s signals (accidental hook fires during very short interactions)
  if (duration < 2000 && status?.phase !== 'awaiting_review') return;

  const tool = { id: toolId, label: toolLabel };
  broadcastResponseComplete(sessionId, tool, Math.max(duration, 0));

  const sName = sessionNames.get(sessionId) || 'Session';
  sendCompletionNotification(sName, tool, Math.max(duration, 0));

  console.log(
    `[hookWatcher] Stop hook → session ${sessionId.slice(0, 8)} | ${toolLabel} | ${formatDuration(duration)}`
  );
}

module.exports = {
  monitorTick,
  handleHookStop,
};
