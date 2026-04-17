import React from 'react';

/**
 * ResourceBar -- renders CPU / Memory / Battery segments in the monitor bar.
 *
 * Consumes the `systemResources` payload from the Zustand store, which is
 * pushed from the main process every 1.5s via IPC.
 *
 * Display rules (from system-monitor-plan.md section 5.3):
 *   - CPU: always visible
 *   - MEM (RSS): always visible
 *   - HEAP: hidden by default (internal metric)
 *   - BATTERY: visible only when battery is present (laptops)
 *   - Color coding: CPU >80% = amber, MEM >80% = amber, Battery <20% = red
 */

/**
 * Format memory value (MB) to a human-readable string.
 *
 * @param {number} mb - Memory in megabytes
 * @returns {string} Formatted string like "1.2 GB" or "128 MB"
 */
function formatMemory(mb) {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${mb} MB`;
}

/**
 * Format remaining minutes to a human-readable string.
 *
 * @param {number|null} minutes - Remaining minutes, or null if unknown
 * @returns {string} Formatted string like "2h 30m" or "45m" or ""
 */
function formatRemaining(minutes) {
  if (minutes === null || minutes === undefined) return '';
  if (minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Inline styles (matching existing monitorBar conventions) ──────────────

const segmentStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  flexShrink: 0,
};

const labelStyle = {
  fontSize: 9,
  color: '#333',
  fontWeight: 700,
  letterSpacing: '0.1em',
};

const valueStyle = {
  fontSize: 11,
  color: '#b0b0b0',
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
};

const dividerStyle = {
  width: 1,
  height: 12,
  background: '#1a1a1a',
};

/**
 * CPU mini progress bar (10px wide, 6px tall).
 * Background is always dark; fill width corresponds to cpuPercent (capped at 100).
 * Color shifts to amber above 80%.
 */
function CpuBar({ percent }) {
  const fill = Math.min(100, Math.max(0, percent));
  const isHigh = percent > 80;
  return (
    <div style={{
      width: 24,
      height: 5,
      background: '#1a1a1a',
      borderRadius: 2,
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <div style={{
        width: `${fill}%`,
        height: '100%',
        background: isHigh ? '#f59e0b' : '#444',
        borderRadius: 2,
        transition: 'width 0.3s ease, background 0.5s ease',
      }} />
    </div>
  );
}

/**
 * BatteryIcon -- simple text-based battery indicator.
 */
function BatteryIndicator({ level, charging }) {
  // Choose icon based on level and charging state
  const icon = charging ? '\u26A1' : level <= 20 ? '\u25A3' : '\u25A2';
  const color = level <= 20 && !charging ? '#ef4444' : '#666';
  return (
    <span style={{ fontSize: 10, color, flexShrink: 0 }}>{icon}</span>
  );
}

export default function ResourceBar({ resources }) {
  if (!resources) return null;

  const { app, battery } = resources;
  if (!app) return null;

  const cpuColor = app.cpuPercent > 80 ? '#f59e0b' : '#b0b0b0';
  const memColor = app.memoryMB > 8192 ? '#f59e0b' : '#b0b0b0'; // >8GB is high
  const batLow = battery.present && !battery.charging && battery.level <= 20;
  const batColor = batLow ? '#ef4444' : '#b0b0b0';

  return (
    <>
      {/* CPU */}
      <div style={dividerStyle} />
      <div style={segmentStyle}>
        <span style={labelStyle}>CPU</span>
        <CpuBar percent={app.cpuPercent} />
        <span style={{ ...valueStyle, color: cpuColor }}>
          {app.cpuPercent.toFixed(1)}%
        </span>
      </div>

      {/* Memory (RSS) */}
      <div style={dividerStyle} />
      <div style={segmentStyle}>
        <span style={labelStyle}>MEM</span>
        <span style={{ ...valueStyle, color: memColor }}>
          {formatMemory(app.memoryMB)}
        </span>
      </div>

      {/* Battery -- only on laptops */}
      {battery.present && (
        <>
          <div style={dividerStyle} />
          <div style={segmentStyle}>
            <span style={labelStyle}>BAT</span>
            <BatteryIndicator level={battery.level} charging={battery.charging} />
            <span style={{ ...valueStyle, color: batColor }}>
              {battery.level}%
              {battery.charging && (
                <span style={{ fontSize: 9, color: '#555', marginLeft: 3 }}>charging</span>
              )}
              {!battery.charging && battery.remainingMinutes != null && (
                <span style={{ fontSize: 9, color: '#555', marginLeft: 3 }}>
                  {formatRemaining(battery.remainingMinutes)}
                </span>
              )}
            </span>
          </div>
        </>
      )}
    </>
  );
}
