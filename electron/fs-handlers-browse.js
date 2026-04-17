/**
 * File system IPC handlers — Directory browsing & read-only queries.
 *
 * Handlers:
 *   fs:listDir          — Lazy directory listing with filtering and truncation
 *   fs:exists           — File existence check
 *   fs:stat             — File metadata (size, type, mtime)
 *   fs:reveal           — Reveal in Finder / open directory
 *   fs:openFile         — Open with default application
 *   fs:readFilePreview  — Read first ~10KB of a file as text preview
 */

const { ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { validatePath } = require('./pathValidator');

const MAX_DIR_ENTRIES = 500;

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.cache',
  'dist', 'build', '.DS_Store', '__pycache__', '.venv', 'venv',
  '.pytest_cache', '.mypy_cache', 'target', '.idea', '.vscode',
]);

/**
 * Register directory-browsing IPC handlers.
 */
function initBrowseIPC() {
  // Directory listing
  ipcMain.handle('fs:listDir', async (_, dirPath) => {
    if (!dirPath || typeof dirPath !== 'string') return { error: 'Invalid path' };
    const validation = validatePath(dirPath);
    if (!validation.valid) return { error: validation.error };
    try {
      const entries = await fs.promises.readdir(validation.resolved, { withFileTypes: true });
      // Truncate raw entries first to bound memory usage for huge directories,
      // then filter and sort.  hasMore is determined by whether the raw list
      // was truncated (the directory had more entries than we read).
      const rawHasMore = entries.length > MAX_DIR_ENTRIES * 2;
      if (rawHasMore) entries.length = MAX_DIR_ENTRIES * 2;
      const items = entries
        .filter((e) => !(e.isDirectory() && IGNORED_DIRS.has(e.name)))
        .map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file',
          path: path.join(validation.resolved, e.name),
          hidden: e.name.startsWith('.'),
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      const hasMore = rawHasMore || items.length > MAX_DIR_ENTRIES;
      if (items.length > MAX_DIR_ENTRIES) items.length = MAX_DIR_ENTRIES;
      return { items, hasMore };
    } catch (e) {
      return { error: e.message };
    }
  });

  // File exists check
  ipcMain.handle('fs:exists', async (_, filePath) => {
    const validation = validatePath(filePath);
    if (!validation.valid) return false;
    try {
      await fs.promises.access(validation.resolved, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  });

  // File stat info
  ipcMain.handle('fs:stat', async (_, filePath) => {
    const validation = validatePath(filePath);
    if (!validation.valid) return { error: validation.error };
    try {
      const stat = await fs.promises.stat(validation.resolved);
      return {
        size: stat.size,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        mtime: stat.mtimeMs,
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Reveal in Finder
  ipcMain.handle('fs:reveal', async (_, filePath) => {
    const validation = validatePath(filePath);
    if (!validation.valid) return { error: validation.error };
    try {
      const stat = await fs.promises.stat(validation.resolved);
      if (stat.isDirectory()) {
        shell.openPath(validation.resolved);
      } else {
        shell.showItemInFolder(validation.resolved);
      }
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Open with default app
  ipcMain.handle('fs:openFile', async (_, filePath) => {
    const validation = validatePath(filePath);
    if (!validation.valid) return { error: validation.error };
    try {
      await shell.openPath(validation.resolved);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Read first ~10KB of a file as text preview
  ipcMain.handle('fs:readFilePreview', async (_, filePath) => {
    const validation = validatePath(filePath);
    if (!validation.valid) return { error: validation.error };
    try {
      const stat = await fs.promises.stat(validation.resolved);
      if (stat.size > 1024 * 1024) return { error: 'File too large (>1MB)' };
      if (stat.isDirectory()) return { error: 'Is a directory' };
      const buffer = Buffer.alloc(Math.min(stat.size, 10 * 1024));
      const fd = await fs.promises.open(validation.resolved, 'r');
      await fd.read(buffer, 0, buffer.length, 0);
      await fd.close();
      return { content: buffer.toString('utf-8'), size: stat.size };
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { initBrowseIPC };
