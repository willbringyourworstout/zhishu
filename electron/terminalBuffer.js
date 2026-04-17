/**
 * terminalBuffer.js -- Terminal buffer persistence module.
 *
 * Saves/restores xterm.js serialized terminal content so that on app restart
 * users can see their previous session output before the pty reconnects.
 *
 * Storage layout: ~/.ai-terminal-manager/buffers/{sessionId}.txt
 * Content limit: 500 KB per session (truncated from the top if exceeded).
 * Auto-cleanup: files older than 7 days are removed on app start.
 */

const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_BUFFER_SIZE = 500 * 1024; // 500 KB
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getBuffersDir() {
  return path.join(os.homedir(), '.ai-terminal-manager', 'buffers');
}

/**
 * Ensure the buffers directory exists. Called once on init.
 */
function ensureBuffersDir() {
  const dir = getBuffersDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Remove buffer files older than MAX_AGE_MS. Called once on app start.
 */
function cleanOldBuffers() {
  const dir = getBuffersDir();
  if (!fs.existsSync(dir)) return;
  const now = Date.now();
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (!file.endsWith('.txt')) continue;
      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > MAX_AGE_MS) {
          fs.unlinkSync(filePath);
        }
      } catch (_) {
        // File may have been removed between readdir and stat; skip.
      }
    }
  } catch (_) {
    // Directory read failed; nothing to clean.
  }
}

/**
 * Save serialized terminal content for a session.
 * Truncates from the top if content exceeds MAX_BUFFER_SIZE.
 */
function saveTerminalBuffer(sessionId, content) {
  if (!sessionId || typeof content !== 'string') return;
  const dir = getBuffersDir();
  try {
    ensureBuffersDir();
    let data = content;
    // Truncate from the top if too large (keep the most recent output).
    if (Buffer.byteLength(data, 'utf8') > MAX_BUFFER_SIZE) {
      // Slice conservatively, then trim until under limit.
      // Estimate: each char is ~1-3 bytes, start from 60% of string length.
      const startIdx = Math.floor(data.length * 0.5);
      data = data.slice(startIdx);
      while (Buffer.byteLength(data, 'utf8') > MAX_BUFFER_SIZE && data.length > 0) {
        data = data.slice(Math.floor(data.length * 0.1));
      }
    }
    fs.writeFileSync(path.join(dir, `${sessionId}.txt`), data, 'utf8');
  } catch (e) {
    console.warn('[terminalBuffer] Failed to save buffer for', sessionId.slice(0, 8), e.message);
  }
}

/**
 * Load saved terminal content for a session.
 * Returns the content string, or null if no saved buffer exists.
 */
function loadTerminalBuffer(sessionId) {
  if (!sessionId) return null;
  try {
    const filePath = path.join(getBuffersDir(), `${sessionId}.txt`);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (_) {
    // File read failed; return null.
  }
  return null;
}

/**
 * Register IPC handlers for terminal buffer persistence.
 */
function initTerminalBufferIPC() {
  ensureBuffersDir();
  cleanOldBuffers();

  ipcMain.handle('buffer:load', (_, sessionId) => {
    return loadTerminalBuffer(sessionId);
  });

  ipcMain.on('buffer:save', (_, { sessionId, content }) => {
    saveTerminalBuffer(sessionId, content);
  });
}

module.exports = { initTerminalBufferIPC, saveTerminalBuffer, loadTerminalBuffer };
