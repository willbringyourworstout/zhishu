/**
 * File system IPC handlers — Image conversion via macOS `sips`.
 *
 * Handlers:
 *   fs:convertHeic    — HEIC -> PNG conversion
 *   fs:normalizeImage — Generic image -> PNG (web-safe formats pass through unchanged)
 */

const { ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { validatePath } = require('./pathValidator');

/**
 * Register image-conversion IPC handlers.
 */
function initImageIPC() {
  // HEIC -> PNG conversion via macOS sips
  ipcMain.handle('fs:convertHeic', async (_, sourcePath) => {
    if (!sourcePath) return { error: 'No source path' };
    const validation = validatePath(sourcePath);
    if (!validation.valid) return { error: validation.error };
    return new Promise((resolve) => {
      const baseName = path.basename(validation.resolved, path.extname(validation.resolved));
      const outputPath = path.join(
        os.tmpdir(),
        `zhishu-${baseName}-${Date.now()}.png`
      );
      execFile('sips',
        ['-s', 'format', 'png', validation.resolved, '--out', outputPath],
        { timeout: 10000 },
        (err, stdout, stderr) => {
          if (err) {
            return resolve({ error: stderr || err.message });
          }
          resolve({ ok: true, path: outputPath });
        }
      );
    });
  });

  // Generic image -> PNG conversion
  ipcMain.handle('fs:normalizeImage', async (_, sourcePath) => {
    if (!sourcePath) return { error: 'No source path' };
    const validation = validatePath(sourcePath);
    if (!validation.valid) return { error: validation.error };
    const ext = path.extname(validation.resolved).toLowerCase();
    const WEB_SAFE = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
    if (WEB_SAFE.includes(ext)) {
      return { ok: true, path: validation.resolved, converted: false };
    }
    return new Promise((resolve) => {
      const baseName = path.basename(validation.resolved, ext);
      const outputPath = path.join(
        os.tmpdir(),
        `zhishu-${baseName}-${Date.now()}.png`
      );
      execFile('sips',
        ['-s', 'format', 'png', validation.resolved, '--out', outputPath],
        { timeout: 10000 },
        (err, stdout, stderr) => {
          if (err) return resolve({ error: stderr || err.message });
          resolve({ ok: true, path: outputPath, converted: true });
        }
      );
    });
  });
}

module.exports = { initImageIPC };
