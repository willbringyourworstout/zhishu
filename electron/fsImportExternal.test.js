/**
 * Tests for fs:importExternal IPC handler logic.
 *
 * 策略：直接测试导出的纯逻辑函数（resolveImportDestPath）
 * 以及基于真实临时目录（os.tmpdir()）的集成场景，无需启动 Electron / IPC。
 *
 * 覆盖场景：
 *   1. 有效文件拷贝成功 → { status: 'ok' }
 *   2. 同名文件 → 自动重命名为 .copy → { status: 'renamed' }
 *   3. .copy 也冲突 → 继续 .copy.2 → { status: 'renamed' }
 *   4. 超大文件（mock stat.size > 100MB）→ { status: 'error', error: 'File too large...' }
 *   5. targetDir 不在 home 下（如 /etc）→ 整批 reject（error 字段）
 *   6. source 是目录 → { status: 'error', error: '...目录...' }
 *   7. source 是符号链接 → { status: 'error', error: '...符号链接...' }
 *   8. 混合场景：3 个文件，1 成功 / 1 重命名 / 1 过大 → ok: false, results 正确分类
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { resolveImportDestPath, MAX_IMPORT_FILE_SIZE } = require('./fs-handlers');
const { validatePath } = require('./pathValidator');

const HOME = os.homedir();

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

/**
 * 在 HOME/.zhishu-test-tmp 中创建隔离的测试目录，返回其路径。
 * macOS 的 os.tmpdir() 解析为 /private/var/... 会被 pathValidator 拒绝，
 * 所以测试目录必须放在 HOME 下。
 * 每个测试用唯一前缀确保隔离。
 */
const TEST_BASE = path.join(HOME, '.zhishu-test-tmp');

async function makeTmpDir(prefix = 'zhishu-test') {
  const dir = path.join(TEST_BASE, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

/** 在指定目录写入一个文本文件，返回文件路径。 */
async function writeFile(dir, name, content = 'hello') {
  const filePath = path.join(dir, name);
  await fs.promises.writeFile(filePath, content, 'utf-8');
  return filePath;
}

/**
 * 简化版 importExternal 核心逻辑，供测试直接调用（绕过 ipcMain 注册）。
 * 逻辑与 handler 完全一致，只是去掉了 IPC 包装。
 */
async function importExternal({ sources, targetDir }) {
  if (!targetDir || typeof targetDir !== 'string') {
    return { ok: false, results: [], error: 'targetDir 必须是非空字符串' };
  }
  const targetV = validatePath(targetDir);
  if (!targetV.valid) {
    return { ok: false, results: [], error: `targetDir 校验失败: ${targetV.error}` };
  }
  let targetStat;
  try {
    targetStat = await fs.promises.stat(targetV.resolved);
  } catch (e) {
    return { ok: false, results: [], error: `targetDir 不存在或无法访问: ${e.message}` };
  }
  if (!targetStat.isDirectory()) {
    return { ok: false, results: [], error: 'targetDir 不是一个目录' };
  }

  if (!Array.isArray(sources) || sources.length === 0) {
    return { ok: false, results: [], error: 'sources 必须是非空数组' };
  }

  const results = [];
  for (const src of sources) {
    if (typeof src !== 'string' || src.length === 0) {
      results.push({ src, dest: null, status: 'error', error: '无效的 source 路径' });
      continue;
    }

    const srcV = validatePath(src);
    if (!srcV.valid) {
      results.push({ src, dest: null, status: 'error', error: srcV.error });
      continue;
    }

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

    if (srcStat.size > MAX_IMPORT_FILE_SIZE) {
      results.push({ src, dest: null, status: 'error', error: 'File too large (>100MB)' });
      continue;
    }

    const baseName = path.basename(srcV.resolved);
    let destResolved, renamed;
    try {
      ({ dest: destResolved, renamed } = await resolveImportDestPath(targetV.resolved, baseName));
    } catch (e) {
      results.push({ src, dest: null, status: 'error', error: `解析目标路径失败: ${e.message}` });
      continue;
    }

    try {
      await fs.promises.cp(srcV.resolved, destResolved);
      results.push({ src, dest: destResolved, status: renamed ? 'renamed' : 'ok' });
    } catch (e) {
      results.push({ src, dest: null, status: 'error', error: e.message });
    }
  }

  const ok = results.every((r) => r.status === 'ok' || r.status === 'renamed');
  return { ok, results };
}

// ─── resolveImportDestPath 单元测试 ──────────────────────────────────────────

test('resolveImportDestPath: 无冲突时返回原始文件名，renamed=false', async () => {
  const dir = await makeTmpDir('resolve-no-conflict');
  const result = await resolveImportDestPath(dir, 'photo.jpg');
  assert.equal(result.renamed, false);
  assert.equal(result.dest, path.join(dir, 'photo.jpg'));
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('resolveImportDestPath: 原名冲突时返回 .copy 后缀，renamed=true', async () => {
  const dir = await makeTmpDir('resolve-first-conflict');
  // 预先占用原名
  await writeFile(dir, 'photo.jpg');
  const result = await resolveImportDestPath(dir, 'photo.jpg');
  assert.equal(result.renamed, true);
  assert.equal(result.dest, path.join(dir, 'photo.copy.jpg'));
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('resolveImportDestPath: .copy 也冲突时返回 .copy.2 后缀', async () => {
  const dir = await makeTmpDir('resolve-second-conflict');
  await writeFile(dir, 'photo.jpg');
  await writeFile(dir, 'photo.copy.jpg');
  const result = await resolveImportDestPath(dir, 'photo.jpg');
  assert.equal(result.renamed, true);
  assert.equal(result.dest, path.join(dir, 'photo.copy.2.jpg'));
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('resolveImportDestPath: .copy 和 .copy.2 都冲突时返回 .copy.3', async () => {
  const dir = await makeTmpDir('resolve-third-conflict');
  await writeFile(dir, 'report.pdf');
  await writeFile(dir, 'report.copy.pdf');
  await writeFile(dir, 'report.copy.2.pdf');
  const result = await resolveImportDestPath(dir, 'report.pdf');
  assert.equal(result.renamed, true);
  assert.equal(result.dest, path.join(dir, 'report.copy.3.pdf'));
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test('resolveImportDestPath: 无扩展名文件的冲突重命名', async () => {
  const dir = await makeTmpDir('resolve-no-ext');
  await writeFile(dir, 'Makefile', '# make');
  const result = await resolveImportDestPath(dir, 'Makefile');
  assert.equal(result.renamed, true);
  // 无扩展名时 ext = '', nameWithoutExt = 'Makefile'
  assert.equal(result.dest, path.join(dir, 'Makefile.copy'));
  await fs.promises.rm(dir, { recursive: true, force: true });
});

// ─── 场景 1: 有效文件拷贝成功 ─────────────────────────────────────────────────

test('场景1: 有效文件拷贝成功 → status: ok', async () => {
  const srcDir = await makeTmpDir('src-ok');
  const destDir = await makeTmpDir('dest-ok');
  const srcFile = await writeFile(srcDir, 'hello.txt', 'world');

  const result = await importExternal({ sources: [srcFile], targetDir: destDir });

  assert.equal(result.ok, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].status, 'ok');
  assert.equal(result.results[0].src, srcFile);
  assert.equal(result.results[0].dest, path.join(destDir, 'hello.txt'));

  // 验证文件确实被复制过去了
  const content = await fs.promises.readFile(path.join(destDir, 'hello.txt'), 'utf-8');
  assert.equal(content, 'world');

  await fs.promises.rm(srcDir, { recursive: true, force: true });
  await fs.promises.rm(destDir, { recursive: true, force: true });
});

// ─── 场景 2: 同名文件自动重命名为 .copy ──────────────────────────────────────

test('场景2: 同名文件自动重命名为 .copy → status: renamed', async () => {
  const srcDir = await makeTmpDir('src-rename');
  const destDir = await makeTmpDir('dest-rename');
  const srcFile = await writeFile(srcDir, 'data.csv', 'a,b,c');
  // 目标目录已有同名文件
  await writeFile(destDir, 'data.csv', 'existing');

  const result = await importExternal({ sources: [srcFile], targetDir: destDir });

  assert.equal(result.ok, true);
  assert.equal(result.results[0].status, 'renamed');
  assert.equal(result.results[0].dest, path.join(destDir, 'data.copy.csv'));

  // 原文件未被覆盖
  const origContent = await fs.promises.readFile(path.join(destDir, 'data.csv'), 'utf-8');
  assert.equal(origContent, 'existing');
  // 新文件内容正确
  const newContent = await fs.promises.readFile(path.join(destDir, 'data.copy.csv'), 'utf-8');
  assert.equal(newContent, 'a,b,c');

  await fs.promises.rm(srcDir, { recursive: true, force: true });
  await fs.promises.rm(destDir, { recursive: true, force: true });
});

// ─── 场景 3: .copy 也冲突 → 继续 .copy.2 ────────────────────────────────────

test('场景3: .copy 也冲突 → 继续 .copy.2 → status: renamed', async () => {
  const srcDir = await makeTmpDir('src-copy2');
  const destDir = await makeTmpDir('dest-copy2');
  const srcFile = await writeFile(srcDir, 'img.png', 'PNG_DATA');
  await writeFile(destDir, 'img.png', 'orig');
  await writeFile(destDir, 'img.copy.png', 'copy1');

  const result = await importExternal({ sources: [srcFile], targetDir: destDir });

  assert.equal(result.ok, true);
  assert.equal(result.results[0].status, 'renamed');
  assert.equal(result.results[0].dest, path.join(destDir, 'img.copy.2.png'));

  await fs.promises.rm(srcDir, { recursive: true, force: true });
  await fs.promises.rm(destDir, { recursive: true, force: true });
});

// ─── 场景 4: 超大文件 → status: error ────────────────────────────────────────

test('场景4: 超大文件（size > 100MB mock）→ status: error, error 含 "too large"', async () => {
  const srcDir = await makeTmpDir('src-large');
  const destDir = await makeTmpDir('dest-large');

  // 创建真实文件，但我们通过劫持 lstat 模拟大小
  const srcFile = await writeFile(srcDir, 'big.bin', 'tiny');

  // 用临时覆盖 lstat 模拟超大文件
  const realLstat = fs.promises.lstat.bind(fs.promises);
  const origLstat = fs.promises.lstat;
  fs.promises.lstat = async (p) => {
    const stat = await realLstat(p);
    if (p === srcFile || p === path.resolve(srcFile)) {
      // 返回一个假的 stat 对象，size 超过 100MB
      return Object.create(stat, {
        size: { value: MAX_IMPORT_FILE_SIZE + 1 },
      });
    }
    return stat;
  };

  try {
    const result = await importExternal({ sources: [srcFile], targetDir: destDir });
    assert.equal(result.ok, false);
    assert.equal(result.results[0].status, 'error');
    assert.ok(result.results[0].error.includes('too large'));
  } finally {
    // 恢复原始 lstat
    fs.promises.lstat = origLstat;
    await fs.promises.rm(srcDir, { recursive: true, force: true });
    await fs.promises.rm(destDir, { recursive: true, force: true });
  }
});

// ─── 场景 5: targetDir 不在 home 下（如 /etc）→ 整批 reject ──────────────────

test('场景5: targetDir 是 /etc → 整批 reject，返回 error 字段', async () => {
  const srcDir = await makeTmpDir('src-badtarget');
  const srcFile = await writeFile(srcDir, 'test.txt');

  const result = await importExternal({ sources: [srcFile], targetDir: '/etc' });

  assert.equal(result.ok, false);
  assert.ok(typeof result.error === 'string');
  assert.ok(result.error.length > 0, 'error 字段应有内容');
  // results 应为空（整批拒绝，未逐项处理）
  assert.equal(result.results.length, 0);

  await fs.promises.rm(srcDir, { recursive: true, force: true });
});

// ─── 场景 6: source 是目录 → status: error ──────────────────────────────────

test('场景6: source 是目录 → status: error, error 含 "目录"', async () => {
  const srcDir = await makeTmpDir('src-dir-source');
  const destDir = await makeTmpDir('dest-dir-source');

  // srcDir 本身就是一个目录，用它作为 source
  const result = await importExternal({ sources: [srcDir], targetDir: destDir });

  assert.equal(result.ok, false);
  assert.equal(result.results[0].status, 'error');
  assert.ok(result.results[0].error.includes('目录'));

  await fs.promises.rm(srcDir, { recursive: true, force: true });
  await fs.promises.rm(destDir, { recursive: true, force: true });
});

// ─── 场景 7: source 是符号链接 → status: error ───────────────────────────────

test('场景7: source 是符号链接 → status: error, error 含 "符号链接"', async () => {
  const srcDir = await makeTmpDir('src-symlink');
  const destDir = await makeTmpDir('dest-symlink');
  const realFile = await writeFile(srcDir, 'real.txt', 'content');
  const linkPath = path.join(srcDir, 'link.txt');
  await fs.promises.symlink(realFile, linkPath);

  const result = await importExternal({ sources: [linkPath], targetDir: destDir });

  assert.equal(result.ok, false);
  assert.equal(result.results[0].status, 'error');
  assert.ok(result.results[0].error.includes('符号链接'));

  await fs.promises.rm(srcDir, { recursive: true, force: true });
  await fs.promises.rm(destDir, { recursive: true, force: true });
});

// ─── 场景 8: 混合场景 ────────────────────────────────────────────────────────

test('场景8: 混合场景 — 1成功/1重命名/1过大 → ok: false, results 正确分类', async () => {
  const srcDir = await makeTmpDir('src-mixed');
  const destDir = await makeTmpDir('dest-mixed');

  // 文件1: 正常文件，无冲突 → ok
  const file1 = await writeFile(srcDir, 'notes.txt', 'hello');
  // 文件2: 同名冲突 → renamed
  const file2 = await writeFile(srcDir, 'config.json', '{}');
  await writeFile(destDir, 'config.json', '{"existing":true}');
  // 文件3: 超大文件 → error（通过 mock）
  const file3 = await writeFile(srcDir, 'huge.bin', 'tiny');

  const realLstat = fs.promises.lstat.bind(fs.promises);
  const origLstat = fs.promises.lstat;
  fs.promises.lstat = async (p) => {
    const stat = await realLstat(p);
    if (p === file3 || p === path.resolve(file3)) {
      return Object.create(stat, {
        size: { value: MAX_IMPORT_FILE_SIZE + 1 },
      });
    }
    return stat;
  };

  try {
    const result = await importExternal({
      sources: [file1, file2, file3],
      targetDir: destDir,
    });

    assert.equal(result.ok, false); // 有 error 项，整体 ok = false
    assert.equal(result.results.length, 3);

    const r1 = result.results.find((r) => r.src === file1);
    const r2 = result.results.find((r) => r.src === file2);
    const r3 = result.results.find((r) => r.src === file3);

    assert.ok(r1, '应有 file1 的 result');
    assert.equal(r1.status, 'ok');

    assert.ok(r2, '应有 file2 的 result');
    assert.equal(r2.status, 'renamed');
    assert.equal(r2.dest, path.join(destDir, 'config.copy.json'));

    assert.ok(r3, '应有 file3 的 result');
    assert.equal(r3.status, 'error');
    assert.ok(r3.error.includes('too large'));
  } finally {
    fs.promises.lstat = origLstat;
    await fs.promises.rm(srcDir, { recursive: true, force: true });
    await fs.promises.rm(destDir, { recursive: true, force: true });
  }
});
