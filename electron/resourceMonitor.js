/**
 * Resource monitor module.
 *
 * Collects system resource usage (CPU, memory, battery) by piggybacking
 * on the existing monitor.js 1.5s tick. No additional polling loop.
 *
 * CPU is computed as delta-time between consecutive ticks for real accuracy
 * (ps pcpu is a lifetime average, time= gives accumulated CPU time).
 * Memory uses RSS from ps for the process tree aggregation.
 * Battery comes from Electron powerMonitor (zero-cost, event-driven).
 */

const os = require('os');

// Previous tick's per-pid time values for CPU delta computation.
// Key: pid (number), Value: accumulated CPU time in seconds.
const prevTimeByPid = new Map();

// Monitor tick interval in seconds (must match the 1.5s interval in main.js).
const TICK_INTERVAL_S = 1.5;

/**
 * Parse ps `time=` field to seconds.
 * Format: "MM:SS.ss" or "HH:MM:SS.ss" or "DDD-HH:MM:SS.ss"
 *
 * @param {string} raw - The time string from ps output
 * @returns {number} Accumulated CPU time in seconds
 */
function parsePsTime(raw) {
  if (!raw || typeof raw !== 'string') return 0;
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  // Handle optional days prefix: "DDD-HH:MM:SS.ss"
  let dayPart = 0;
  let timePart = trimmed;
  if (trimmed.includes('-')) {
    const dashIdx = trimmed.indexOf('-');
    dayPart = parseInt(trimmed.substring(0, dashIdx), 10) || 0;
    timePart = trimmed.substring(dashIdx + 1);
  }

  const parts = timePart.split(':').map(Number);
  if (parts.some(isNaN)) return 0;

  let seconds = 0;
  if (parts.length === 3) {
    // HH:MM:SS.ss
    seconds = (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  } else if (parts.length === 2) {
    // MM:SS.ss
    seconds = (parts[0] * 60) + parts[1];
  } else {
    seconds = parts[0] || 0;
  }

  return dayPart * 86400 + seconds;
}

/**
 * Collect resource usage for the entire app process tree.
 *
 * Walks the process tree starting from `process.pid` (Electron main),
 * sums CPU delta and RSS for all descendants. Also reads system-wide
 * memory info and (optionally) battery status.
 *
 * @param {Map<number, {pid,ppid,time,rss,command}>} byPid - Process snapshot from ps
 * @param {{ getBatteryStatus?: Function }} [deps] - Optional Electron powerMonitor reference
 * @returns {Object} Resource payload matching the schema in system-monitor-plan.md
 */
function collectResourceSnapshot(byPid, deps) {
  const now = Date.now();

  // ── Process tree aggregation (BFS from process.pid) ──────────────────────
  let totalCpuPercent = 0;
  let totalRssKB = 0;
  let pidCount = 0;

  const visited = new Set();
  const queue = [process.pid];

  while (queue.length > 0) {
    const pid = queue.shift();
    if (visited.has(pid)) continue;
    visited.add(pid);

    // Find this process in the snapshot
    const proc = byPid.get(pid);
    if (proc) {
      pidCount++;

      // CPU delta calculation
      const currentTime = typeof proc.time === 'number' ? proc.time : parsePsTime(proc.time);
      const prevTime = prevTimeByPid.get(pid);
      if (prevTime !== undefined && currentTime >= prevTime) {
        const deltaS = currentTime - prevTime;
        const cpuPercent = (deltaS / TICK_INTERVAL_S) * 100;
        totalCpuPercent += cpuPercent;
      }
      // Always update stored time for next tick
      prevTimeByPid.set(pid, currentTime);

      // RSS aggregation (ps reports in KB)
      const rss = typeof proc.rss === 'number' ? proc.rss : 0;
      totalRssKB += rss;
    } else {
      // Process exists but not in ps snapshot (e.g. just exited) -- skip
    }

    // BFS: find children
    for (const [, p] of byPid) {
      if (p.ppid === pid && !visited.has(p.pid)) {
        queue.push(p.pid);
      }
    }
  }

  // Clean up stale entries from prevTimeByPid (processes no longer in snapshot)
  for (const pid of prevTimeByPid.keys()) {
    if (!visited.has(pid)) {
      prevTimeByPid.delete(pid);
    }
  }

  // ── Electron main process heap ───────────────────────────────────────────
  const memUsage = process.memoryUsage();

  // ── System-wide context ──────────────────────────────────────────────────
  const cpuCount = os.cpus().length;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const loadAvg = os.loadavg();

  // ── Battery (via Electron powerMonitor) ──────────────────────────────────
  let battery = { present: false, charging: false, level: 100, remainingMinutes: null };

  if (deps && typeof deps.getBatteryStatus === 'function') {
    try {
      const bat = deps.getBatteryStatus();
      // powerMonitor.getBatteryStatus() returns:
      //   { charging: boolean, level: number (0-100), secondsRemaining: number|null }
      // secondsRemaining is -1 when charging or computing estimate
      const secondsRemaining = bat.secondsRemaining;
      let remainingMinutes = null;
      if (secondsRemaining && secondsRemaining > 0) {
        remainingMinutes = Math.round(secondsRemaining / 60);
      }

      // Detect desktop Macs (no battery): charging=true, level=100, secondsRemaining=-1
      // consistently. We treat this as "no battery present".
      const isDesktop = bat.charging === true && bat.level === 100 && (secondsRemaining === -1 || secondsRemaining === null);

      battery = {
        present: !isDesktop,
        charging: !!bat.charging,
        level: typeof bat.level === 'number' ? bat.level : 100,
        remainingMinutes,
      };
    } catch (e) {
      // powerMonitor may not be available in all environments
      // Keep default battery object
    }
  }

  // ── Assemble payload ─────────────────────────────────────────────────────
  return {
    ts: now,

    app: {
      cpuPercent: Math.round(totalCpuPercent * 10) / 10,   // One decimal place
      memoryMB: Math.round(totalRssKB / 1024),              // KB -> MB, rounded
      pidCount,
      heapUsedMB: Math.round(memUsage.heapUsed / (1024 * 1024)),
      heapTotalMB: Math.round(memUsage.heapTotal / (1024 * 1024)),
    },

    system: {
      cpuCount,
      cpuLoadAverage: cpuCount > 0 ? Math.round((loadAvg[0] / cpuCount) * 100) / 100 : 0,
      totalMemoryGB: Math.round((totalMem / (1024 * 1024 * 1024)) * 100) / 100,
      freeMemoryGB: Math.round((freeMem / (1024 * 1024 * 1024)) * 100) / 100,
      usedMemoryPercent: totalMem > 0
        ? Math.round(((1 - freeMem / totalMem) * 100) * 10) / 10
        : 0,
    },

    battery,
  };
}

module.exports = {
  collectResourceSnapshot,
  parsePsTime,
};
