/**
 * File system IPC handlers — File mutation operations.
 *
 * Handlers:
 *   fs:writeFile       — Write a text file (creates parent dirs)
 *   fs:trash           — Send to macOS Trash
 *   fs:rename          — Rename (newName must be basename — path traversal prevention)
 *   fs:copy            — Recursive copy
 *   fs:move            — Move (cross-filesystem fallback: copy + delete)
 *   fs:zip             — Compress using system `zip` command
 *   fs:newFile         — Create empty file
 *   fs:newFolder       — Create empty directory
 *   fs:importExternal  — Batch-copy external files into project directory
 */

const { ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { validatePath } = require('./pathValidator');

const MAX_IMPORT_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * Resolve an import destination path, handling name collisions.
 * Conflict strategy (keep both):
 *   base.ext  ->  base.copy.ext  ->  base.copy.2.ext  ->  base.copy.3.ext ...
 *
 * @param {string} targetDirResolved  Absolute target directory (already resolved)
 * @param {string} baseName           Source file basename (with extension)
 * @returns {Promise<{ dest: string, renamed: boolean }>}
 */
async function resolveImportDestPath(targetDirResolved, baseName) {
  const ext = path.extname(baseName);
  const nameWithoutExt = path.basename(baseName, ext);

  // Try the original filename first
  let candidate = path.join(targetDirResolved, baseName);
  try {
    await fs.promises.access(candidate, fs.constants.F_OK);
    // Conflict exists, enter rename logic
  } catch {
    return { dest: candidate, renamed: false };
  }

  // First conflict: base.copy.ext
  candidate = path.join(targetDirResolved, `${nameWithoutExt}.copy${ext}`);
  try {
    await fs.promises.access(candidate, fs.constants.F_OK);
    // Still conflicts, append sequence number
  } catch {
    return { dest: candidate, renamed: true };
  }

  // Continued conflicts: base.copy.N.ext (N starts from 2)
  for (let n = 2; n <= 999; n++) {
    candidate = path.join(targetDirResolved, `${nameWithoutExt}.copy.${n}${ext}`);
    try {
      await fs.promises.access(candidate, fs.constants.F_OK);
      // Still conflicts, continue
    } catch {
      return { dest: candidate, renamed: true };
    }
  }

  // Extreme case: 999 conflicts all taken, append timestamp fallback
  const fallback = path.join(targetDirResolved, `${nameWithoutExt}.copy.${Date.now()}${ext}`);
  return { dest: fallback, renamed: true };
}

/**
 * Register file-operation IPC handlers.
 */
function initOperationsIPC() {
  // Write a text file
  ipcMain.handle('fs:writeFile', async (_, filePath, content) => {
    const validation = validatePath(filePath);
    if (!validation.valid) return { error: validation.error };
    try {
      await fs.promises.mkdir(path.dirname(validation.resolved), { recursive: true });
      await fs.promises.writeFile(validation.resolved, content, 'utf-8');
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Send to Trash
  ipcMain.handle('fs:trash', async (_, filePath) => {
    const validation = validatePath(filePath);
    if (!validation.valid) return { error: validation.error };
    try {
      await shell.trashItem(validation.resolved);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Rename (no path traversal — newName must be a basename)
  ipcMain.handle('fs:rename', async (_, oldPath, newName) => {
    const validation = validatePath(oldPath);
    if (!validation.valid) return { error: validation.error };
    try {
      if (typeof newName !== 'string' || newName.includes('/') || newName.includes('\\')) {
        return { error: 'newName 必须是文件名（不含路径分隔符）' };
      }
      const dir = path.dirname(validation.resolved);
      const newPath = path.join(dir, newName);
      const destValidation = validatePath(newPath);
      if (!destValidation.valid) return { error: destValidation.error };
      await fs.promises.rename(validation.resolved, destValidation.resolved);
      return { ok: true, newPath: destValidation.resolved };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Recursive copy
  ipcMain.handle('fs:copy', async (_, src, dest) => {
    const srcV = validatePath(src);
    if (!srcV.valid) return { error: srcV.error };
    const destV = validatePath(dest);
    if (!destV.valid) return { error: destV.error };
    try {
      await fs.promises.cp(srcV.resolved, destV.resolved, { recursive: true, errorOnExist: false, force: true });
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Move (rename across paths, fallback to copy+delete for cross-filesystem)
  ipcMain.handle('fs:move', async (_, src, dest) => {
    const srcV = validatePath(src);
    if (!srcV.valid) return { error: srcV.error };
    const destV = validatePath(dest);
    if (!destV.valid) return { error: destV.error };
    try {
      await fs.promises.rename(srcV.resolved, destV.resolved);
      return { ok: true };
    } catch (e) {
      if (e.code === 'EXDEV') {
        try {
          await fs.promises.cp(srcV.resolved, destV.resolved, { recursive: true });
          await fs.promises.rm(srcV.resolved, { recursive: true, force: true });
          return { ok: true };
        } catch (e2) {
          return { error: e2.message };
        }
      }
      return { error: e.message };
    }
  });

  // Zip using system `zip` command
  ipcMain.handle('fs:zip', async (_, srcPath) => {
    const validation = validatePath(srcPath);
    if (!validation.valid) return { error: validation.error };
    return new Promise((resolve) => {
      const dir = path.dirname(validation.resolved);
      const name = path.basename(srcPath);
      const zipName = `${name}.zip`;
      const zipPath = path.join(dir, zipName);
      execFile('zip', ['-r', '-q', zipName, name], { cwd: dir, timeout: 60000 }, (err) => {
        if (err) return resolve({ error: err.message });
        resolve({ ok: true, path: zipPath });
      });
    });
  });

  // Create empty file
  ipcMain.handle('fs:newFile', async (_, dirPath, name) => {
    const dirValidation = validatePath(dirPath);
    if (!dirValidation.valid) return { error: dirValidation.error };
    try {
      if (typeof name !== 'string' || name.includes('/') || name.includes('\\')) {
        return { error: '文件名必须不含路径分隔符' };
      }
      const filePath = path.join(dirValidation.resolved, name);
      const fileValidation = validatePath(filePath);
      if (!fileValidation.valid) return { error: fileValidation.error };
      await fs.promises.writeFile(fileValidation.resolved, '', { flag: 'wx' });
      return { ok: true, path: fileValidation.resolved };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Create empty directory
  ipcMain.handle('fs:newFolder', async (_, dirPath, name) => {
    const dirValidation = validatePath(dirPath);
    if (!dirValidation.valid) return { error: dirValidation.error };
    try {
      if (typeof name !== 'string' || name.includes('/') || name.includes('\\')) {
        return { error: '文件夹名必须不含路径分隔符' };
      }
      const folderPath = path.join(dirValidation.resolved, name);
      const folderValidation = validatePath(folderPath);
      if (!folderValidation.valid) return { error: folderValidation.error };
      await fs.promises.mkdir(folderValidation.resolved);
      return { ok: true, path: folderValidation.resolved };
    } catch (e) {
      return { error: e.message };
    }
  });

  // Import external files (e.g. drag-dropped from Finder) into the project cwd.
  // sources: external file absolute paths array; targetDir: target directory (current project cwd)
  // Same-name files are kept both, auto-renamed to baseName.copy.ext, further conflicts .copy.2 / .copy.3 ...
  ipcMain.handle('fs:importExternal', async (_, { sources, targetDir } = {}) => {
    // Validate targetDir: must exist, be a directory, under home
    if (!targetDir || typeof targetDir !== 'string') {
      return { ok: false, results: [], error: 'targetDir 必须是非空字符串' };
    }
    const targetV = validatePath(targetDir);
    if (!targetV.valid) {
      return { ok: false, results: [], error: `targetDir 校验失败: ${targetV.error}` };
    }
    try {
      const targetStat = await fs.promises.stat(targetV.resolved);
      if (!targetStat.isDirectory()) {
        return { ok: false, results: [], error: 'targetDir 不是一个目录' };
      }
    } catch (e) {
      return { ok: false, results: [], error: `targetDir 不存在或无法访问: ${e.message}` };
    }

    if (!Array.isArray(sources) || sources.length === 0) {
      return { ok: false, results: [], error: 'sources 必须是非空数组' };
    }

    // Defense-in-depth: cap batch size to avoid Main-process blocking on malicious/accidental flood.
    const MAX_SOURCES = 200;
    if (sources.length > MAX_SOURCES) {
      return { ok: false, results: [], error: `单次最多导入 ${MAX_SOURCES} 个文件` };
    }

    // Process one by one; single-file failure does not abort the batch
    const results = [];
    for (const src of sources) {
      if (typeof src !== 'string' || src.length === 0) {
        results.push({ src, dest: null, status: 'error', error: '无效的 source 路径' });
        continue;
      }

      // Validate source path security
      const srcV = validatePath(src);
      if (!srcV.valid) {
        results.push({ src, dest: null, status: 'error', error: srcV.error });
        continue;
      }

      // Must be a regular file: lstat distinguishes symlinks (stat follows links)
      let srcStat;
      try {
        srcStat = await fs.promises.lstat(srcV.resolved);
      } catch (e) {
        results.push({ src, dest: null, status: 'error', error: `无法访问文件: ${e.message}` });
        continue;
      }

      if (srcStat.isDirectory()) {
        results.push({ src, dest: null, status: 'error', error: '不支持导入目录，请通过"添加为项目"处理文件夹' });
        continue;
      }
      if (srcStat.isSymbolicLink()) {
        results.push({ src, dest: null, status: 'error', error: '不支持导入符号链接' });
        continue;
      }
      if (!srcStat.isFile()) {
        results.push({ src, dest: null, status: 'error', error: '路径不是普通文件' });
        continue;
      }

      // Size limit 100MB
      if (srcStat.size > MAX_IMPORT_FILE_SIZE) {
        results.push({ src, dest: null, status: 'error', error: 'File too large (>100MB)' });
        continue;
      }

      // Resolve destination path (handle name collisions)
      const baseName = path.basename(srcV.resolved);
      let destResolved;
      let renamed;
      try {
        ({ dest: destResolved, renamed } = await resolveImportDestPath(targetV.resolved, baseName));
      } catch (e) {
        results.push({ src, dest: null, status: 'error', error: `解析目标路径失败: ${e.message}` });
        continue;
      }

      // Execute copy (Node 18+ native fs.promises.cp)
      try {
        await fs.promises.cp(srcV.resolved, destResolved);
        results.push({
          src,
          dest: destResolved,
          status: renamed ? 'renamed' : 'ok',
        });
      } catch (e) {
        results.push({ src, dest: null, status: 'error', error: e.message });
      }
    }

    const ok = results.every((r) => r.status === 'ok' || r.status === 'renamed');
    return { ok, results };
  });
}

module.exports = {
  initOperationsIPC,
  // Exported for unit testing (pure filesystem logic, no IPC dependency)
  resolveImportDestPath,
  MAX_IMPORT_FILE_SIZE,
};
