/**
 * hookWatcher.js
 *
 * Implements the Claude Code Stop hook integration for precise
 * "response complete" notification timing.
 *
 * How it works:
 *   1. ensureClaudeHook() writes a Stop hook into ~/.claude/settings.json
 *      (safe merge — never overwrites other settings).
 *   2. When the app launches an AI tool, it prepends
 *      AI_TERMINAL_SESSION_ID='<uuid>' to the command so Claude Code
 *      inherits the session ID in its environment.
 *   3. When Claude Code's main loop finishes (all tool-calls complete),
 *      the Stop hook writes an empty sentinel file at
 *      /tmp/aitm-stop-<sessionId>.
 *   4. initHookWatcher() uses fs.watch() on /tmp to detect that file,
 *      deletes it, and calls onStop(sessionId) for immediate notification
 *      — no polling delay, no false positives from tool-call pauses.
 *
 * Safety guarantees on the hook command:
 *   - [ -n "$AI_TERMINAL_SESSION_ID" ]  →  silent no-op outside this app
 *   - 2>/dev/null                        →  suppresses I/O errors
 *   - || true                            →  always exits 0, no hook error dialog
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const HOOK_SIGNAL_PREFIX = 'aitm-stop-';

// The exact hook command stored in ~/.claude/settings.json.
// Must stay in sync with HOOK_SIGNAL_PREFIX above.
const HOOK_COMMAND =
  '[ -n "$AI_TERMINAL_SESSION_ID" ] && ' +
  'printf \'\' > /tmp/aitm-stop-"$AI_TERMINAL_SESSION_ID" 2>/dev/null ' +
  '|| true';

/**
 * Safely merge our Stop hook into ~/.claude/settings.json.
 * Idempotent: does nothing if the hook is already present.
 * Never touches any other field in settings.json.
 */
function ensureClaudeHook() {
  const settingsDir  = path.join(os.homedir(), '.claude');
  const settingsPath = path.join(settingsDir, 'settings.json');

  // ── Read existing settings ────────────────────────────────────────────────
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      // Malformed JSON — leave it alone, don't risk corrupting the file
      console.warn('[hookWatcher] ~/.claude/settings.json is not valid JSON; skipping hook setup:', e.message);
      return;
    }
  }

  // ── Check for existing hook (idempotency) ─────────────────────────────────
  const stopHooks = (settings.hooks && Array.isArray(settings.hooks.Stop))
    ? settings.hooks.Stop
    : [];

  const alreadyRegistered = stopHooks.some((entry) =>
    Array.isArray(entry.hooks) &&
    entry.hooks.some((h) => h.type === 'command' && h.command === HOOK_COMMAND)
  );

  if (alreadyRegistered) {
    console.log('[hookWatcher] Claude Code Stop hook already registered — skipping');
    return;
  }

  // ── Merge hook ────────────────────────────────────────────────────────────
  const newEntry = {
    matcher: '',
    hooks: [{ type: 'command', command: HOOK_COMMAND }],
  };

  settings.hooks = {
    ...(settings.hooks || {}),
    Stop: [...stopHooks, newEntry],
  };

  try {
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    console.log('[hookWatcher] Registered Claude Code Stop hook in ~/.claude/settings.json');
  } catch (e) {
    console.error('[hookWatcher] Failed to write ~/.claude/settings.json:', e.message);
  }
}

/**
 * Start watching /tmp for Stop hook signal files.
 *
 * @param {function(sessionId: string): void} onStop
 *   Called when Claude Code fires the Stop hook for a session managed by this app.
 * @returns {function(): void} cleanup — call on app quit to stop the watcher.
 */
function initHookWatcher(onStop) {
  const tmpDir = os.tmpdir();

  // Clean up stale signal files left over from a previous crash/run
  try {
    const stale = fs.readdirSync(tmpDir).filter((f) => f.startsWith(HOOK_SIGNAL_PREFIX));
    for (const f of stale) {
      try { fs.unlinkSync(path.join(tmpDir, f)); } catch (_) {}
    }
    if (stale.length > 0) {
      console.log(`[hookWatcher] Cleaned ${stale.length} stale signal file(s)`);
    }
  } catch (_) {}

  let watcher;
  try {
    // persistent: false → don't keep the event loop alive just for this watcher
    watcher = fs.watch(tmpDir, { persistent: false }, (eventType, filename) => {
      if (!filename || !filename.startsWith(HOOK_SIGNAL_PREFIX)) return;

      const sessionId = filename.slice(HOOK_SIGNAL_PREFIX.length);
      if (!sessionId) return;

      // Delete the sentinel file immediately to prevent double-firing
      try { fs.unlinkSync(path.join(tmpDir, filename)); } catch (_) {}

      try {
        onStop(sessionId);
      } catch (e) {
        console.error('[hookWatcher] onStop callback threw:', e.message);
      }
    });

    watcher.on('error', (e) => {
      // FSEvents errors are rare on macOS — log and continue
      console.error('[hookWatcher] fs.watch error:', e.message);
    });

    console.log('[hookWatcher] Watching', tmpDir, 'for Claude Code stop signals');
  } catch (e) {
    console.error('[hookWatcher] Failed to start fs.watch:', e.message);
    return () => {};
  }

  return () => {
    try { if (watcher) watcher.close(); } catch (_) {}
  };
}

module.exports = { ensureClaudeHook, initHookWatcher };
