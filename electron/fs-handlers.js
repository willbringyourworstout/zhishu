/**
 * File system IPC handlers — entry point.
 *
 * Re-exports initFsIPC() which delegates to domain-specific sub-modules:
 *   - fs-handlers-browse.js     (directory listing, stat, reveal, open, preview)
 *   - fs-handlers-operations.js (write, trash, rename, copy, move, zip, newFile, newFolder, importExternal)
 *   - fs-handlers-image.js      (HEIC/normalize image conversion via sips)
 *
 * preload.js and renderer remain unchanged — IPC channel names are identical.
 */

const { initBrowseIPC } = require('./fs-handlers-browse');
const { initOperationsIPC, resolveImportDestPath, MAX_IMPORT_FILE_SIZE } = require('./fs-handlers-operations');
const { initImageIPC } = require('./fs-handlers-image');

/**
 * Register all file-system IPC handlers.
 * Delegates to domain-specific init functions.
 */
function initFsIPC() {
  initBrowseIPC();
  initOperationsIPC();
  initImageIPC();
}

module.exports = {
  initFsIPC,
  // Re-exported for unit test backward compatibility (fsImportExternal.test.js imports from './fs-handlers')
  resolveImportDestPath,
  MAX_IMPORT_FILE_SIZE,
};
