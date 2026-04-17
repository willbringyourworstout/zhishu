import { TOOL_COLORS, TOOL_LABELS, PHASE_STANDBY, PHASE_REVIEW } from '../../constants/toolVisuals';

// Re-export the shared duration formatter so sidebar sub-components
// can keep importing from helpers.js without changing call sites.
export { formatDuration as fmtDuration } from '../../utils/format';

// Semantic phase colors re-exported for local readability
const COLOR_STANDBY = PHASE_STANDBY;
const COLOR_REVIEW  = PHASE_REVIEW;

/**
 * Four-state phase -> visual indicator.
 *
 * not_started         -> no indicator (offline)
 * idle_no_instruction -> slate/grey, slow breathing (standby, waiting for user)
 * running             -> brand-color, fast pulse (AI generating)
 * awaiting_review     -> green, slow breathing (response done, review needed)
 */
export function getPhaseIndicator(status) {
  if (!status?.tool || status.phase === 'not_started') return null;

  if (status.phase === 'running') {
    return {
      color: TOOL_COLORS[status.tool] || '#888',
      animation: 'pulse 1.2s ease-in-out infinite',
      title: `${status.label || status.tool} 运行中`,
    };
  }
  if (status.phase === 'awaiting_review') {
    return {
      color: COLOR_REVIEW,
      animation: 'breathe 2.5s ease-in-out infinite',
      title: `${status.label || status.tool} 运行后待审查`,
    };
  }
  if (status.phase === 'idle_no_instruction') {
    return {
      color: COLOR_STANDBY,
      animation: 'breathe 3s ease-in-out infinite',
      title: `${status.label || status.tool} 未指令`,
    };
  }
  return null;
}

// Re-export TOOL_COLORS and TOOL_LABELS so sub-components can import from one place
export { TOOL_COLORS, TOOL_LABELS };
