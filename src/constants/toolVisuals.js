/**
 * Single source of truth for tool/provider visual metadata.
 *
 * Every component that needs brand colors, labels, or glow values imports
 * from this file instead of defining its own copy. Adding a new provider
 * only requires editing this one file.
 *
 * Re-exports are provided in both the enriched shape (TOOL_VISUALS with
 * label + color + glow) and the simpler shapes (TOOL_COLORS, TOOL_LABELS)
 * so consumers can import the most convenient form.
 */

// ─── Core definition ( richest shape ) ──────────────────────────────────────

const TOOL_VISUALS = {
  claude:   { label: 'Claude',   color: '#d97706', glow: 'rgba(217, 119, 6, 0.35)' },
  codex:    { label: 'Codex',    color: '#16a34a', glow: 'rgba(22, 163, 74, 0.35)' },
  gemini:   { label: 'Gemini',   color: '#3b82f6', glow: 'rgba(59, 130, 246, 0.35)' },
  qwen:     { label: 'Qwen',     color: '#06b6d4', glow: 'rgba(6, 182, 212, 0.35)' },
  opencode: { label: 'OpenCode', color: '#f97316', glow: 'rgba(249, 115, 22, 0.35)' },
  glm:      { label: 'GLM',      color: '#a855f7', glow: 'rgba(168, 85, 247, 0.35)' },
  minimax:  { label: 'MiniMax',  color: '#ec4899', glow: 'rgba(236, 72, 153, 0.35)' },
  kimi:     { label: 'Kimi',     color: '#0ea5e9', glow: 'rgba(14, 165, 233, 0.35)' },
  qwencp:   { label: 'QwenCP',   color: '#0d9488', glow: 'rgba(13, 148, 136, 0.35)' },
};

// ─── Derived convenience maps ───────────────────────────────────────────────

const TOOL_COLORS = Object.fromEntries(
  Object.entries(TOOL_VISUALS).map(([id, v]) => [id, v.color]),
);

const TOOL_LABELS = Object.fromEntries(
  Object.entries(TOOL_VISUALS).map(([id, v]) => [id, v.label]),
);

// ─── Semantic phase colors (used by TerminalView + Sidebar) ─────────────────

const PHASE_STANDBY = '#64748b';  // idle_no_instruction
const PHASE_REVIEW  = '#22c55e';  // awaiting_review

// ─── Preset color palette (12 colors for custom provider selection) ──────────

const PRESET_COLORS = [
  '#d97706', '#16a34a', '#3b82f6', '#ef4444',
  '#a855f7', '#06b6d4', '#ec4899', '#f97316',
  '#6366f1', '#0d9488', '#eab308', '#64748b',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a HEX color to its glow equivalent (rgba with 0.35 alpha). */
function hexToGlow(hex) {
  if (!hex || hex[0] !== '#') return 'rgba(100,116,139,0.35)';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.35)`;
}

/**
 * Unified visual lookup: built-in tools first, then custom providers, then fallback.
 *
 * @param {string} toolId
 * @param {Object} customProviders - Map of custom provider objects from store
 * @returns {{ label: string, color: string, glow: string }}
 */
function getVisualForTool(toolId, customProviders = {}) {
  // 1. Built-in TOOL_VISUALS
  if (TOOL_VISUALS[toolId]) return TOOL_VISUALS[toolId];
  // 2. Custom Provider
  const custom = customProviders[toolId];
  if (custom) {
    return {
      label: custom.name,
      color: custom.color,
      glow: hexToGlow(custom.color),
    };
  }
  // 3. Fallback
  return { label: toolId, color: '#64748b', glow: 'rgba(100,116,139,0.35)' };
}

// ─── Exports ────────────────────────────────────────────────────────────────

export {
  TOOL_VISUALS,
  TOOL_COLORS,
  TOOL_LABELS,
  PHASE_STANDBY,
  PHASE_REVIEW,
  PRESET_COLORS,
  hexToGlow,
  getVisualForTool,
};
