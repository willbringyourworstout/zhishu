/**
 * Shared formatting utilities.
 *
 * Single source of truth for duration formatting used across components:
 *   TerminalView, ToastStack, sidebar/SessionRow.
 */

/**
 * Format milliseconds into a compact duration string with zero-padded minutes/seconds.
 *
 * Examples: "1h 05m" / "5m 12s" / "45s" / "0s"
 *
 * @param {number} ms - Duration in milliseconds (negative or falsy returns "0s")
 * @returns {string} Formatted duration
 */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
