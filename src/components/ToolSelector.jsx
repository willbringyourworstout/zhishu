/**
 * ToolSelector — dropdown selector replacing the tiled toolbar buttons.
 *
 * Groups tools into "Anthropic endpoints" and "Standalone tools".
 * Supports custom Anthropic-format endpoints. Renders via Portal to
 * avoid clipping in split-pane containers.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ToolIcon } from './ToolIcons';
import {
  TOOL_VISUALS,
  PRESET_COLORS,
  getVisualForTool,
} from '../constants/toolVisuals';

// ─── Grouping logic ──────────────────────────────────────────────────────────

/**
 * Build the two groups of items for the dropdown.
 *
 * @param {Object} toolCatalog - { tools, providers } from main process
 * @param {Object} customProviders - custom providers from store
 * @returns {{ anthropicEndpoints: Array, standaloneTools: Array }}
 */
function buildGroups(toolCatalog, customProviders) {
  const anthropicEndpoints = [];

  // Built-in Anthropic tool: claude
  if (toolCatalog.tools?.claude) {
    anthropicEndpoints.push({
      id: 'claude',
      kind: 'tool',
      name: toolCatalog.tools.claude.name,
    });
  }

  // Built-in providers: glm, minimax, kimi, qwencp
  const builtinProviders = ['glm', 'minimax', 'kimi', 'qwencp'];
  for (const id of builtinProviders) {
    if (toolCatalog.providers?.[id]) {
      anthropicEndpoints.push({
        id,
        kind: 'provider',
        name: toolCatalog.providers[id].name,
      });
    }
  }

  // Custom providers
  for (const cp of Object.values(customProviders || {})) {
    anthropicEndpoints.push({
      id: cp.id,
      kind: 'custom-provider',
      name: cp.name,
      baseTool: 'claude',
    });
  }

  // Standalone tools
  const standaloneTools = ['codex', 'gemini']
    .filter((id) => toolCatalog.tools?.[id])
    .map((id) => ({
      id,
      kind: 'tool',
      name: toolCatalog.tools[id].name,
    }));

  return { anthropicEndpoints, standaloneTools };
}

// ─── Chevron icon ────────────────────────────────────────────────────────────

function ChevronIcon({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 4.5 L6 7.5 L9 4.5"
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Build flat installed-tool list ─────────────────────────────────────────

function buildInstalledItems(toolCatalog, toolStatus, customProviders) {
  const all = [];
  const { anthropicEndpoints, standaloneTools } = buildGroups(toolCatalog, customProviders);
  for (const item of [...anthropicEndpoints, ...standaloneTools]) {
    if (item.kind === 'tool' && toolStatus[item.id]?.installed === true) {
      all.push(item);
    } else if (item.kind === 'provider' || item.kind === 'custom-provider') {
      // Providers always appear (key must be configured, but still show as installed)
      all.push(item);
    }
  }
  return all;
}

// ─── Pinned button ───────────────────────────────────────────────────────────

function PinnedButton({ item, isCurrent, customProviders, onSelect }) {
  const visual = getVisualForTool(item.id, customProviders);
  const initial = (visual.label || item.id)[0].toUpperCase();

  return (
    <button
      onClick={(e) => onSelect(item, e)}
      title={visual.label}
      style={{
        ...pinnedStyles.btn,
        borderColor: isCurrent ? visual.color : 'var(--border-button, #2a2a2e)',
        background: isCurrent ? `${visual.color}18` : 'var(--bg-button, #1a1a1e)',
        boxShadow: isCurrent ? `0 0 0 1px ${visual.color}44` : 'none',
      }}
    >
      <span style={{ ...pinnedStyles.iconBox, color: visual.color, background: `${visual.color}14`, borderColor: `${visual.color}55` }}>
        <ToolIcon id={item.id} size={11} color="currentColor" />
      </span>
      <span style={{ ...pinnedStyles.initial, color: isCurrent ? visual.color : 'var(--text-secondary, #a1a1aa)' }}>
        {initial}
      </span>
    </button>
  );
}

const pinnedStyles = {
  btn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 7px',
    border: '1px solid',
    borderRadius: 6,
    cursor: 'pointer',
    background: 'var(--bg-button, #1a1a1e)',
    transition: 'all 0.15s',
    outline: 'none',
    flexShrink: 0,
  },
  iconBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    border: '1px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  initial: {
    fontSize: 10,
    fontWeight: 600,
    fontFamily: 'var(--font-ui, system-ui)',
    lineHeight: 1,
  },
};

// ─── Main component ──────────────────────────────────────────────────────────

export default function ToolSelector({
  sessionId,
  yoloMode,
  toolCatalog,
  toolStatus,
  providerConfigs,
  customProviders,
  sessionLastTool,
  onLaunchTool,
  onLaunchProvider,
  onOpenSettings,
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);

  const currentToolId = sessionLastTool || 'claude';
  const currentVisual = getVisualForTool(currentToolId, customProviders);

  const { anthropicEndpoints, standaloneTools } = buildGroups(toolCatalog, customProviders);

  // Pinned / overflow split
  const installedItems = buildInstalledItems(toolCatalog, toolStatus, customProviders);
  const usePinnedLayout = installedItems.length <= 4;
  const PINNED_MAX = 3;
  const pinnedItems = usePinnedLayout ? installedItems : installedItems.slice(0, PINNED_MAX);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (
        triggerRef.current?.contains(e.target) ||
        dropdownRef.current?.contains(e.target)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open]);

  // Compute dropdown position from trigger button
  const getDropdownStyle = useCallback(() => {
    if (!triggerRef.current) return {};
    const rect = triggerRef.current.getBoundingClientRect();
    return {
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      zIndex: 99999,
    };
  }, []);

  const handleSelect = useCallback((item, e) => {
    setOpen(false);

    if (item.kind === 'tool') {
      onLaunchTool(item.id, { continueMode: e?.shiftKey });
    } else if (item.kind === 'provider' || item.kind === 'custom-provider') {
      onLaunchProvider(item.id, { continueMode: e?.shiftKey });
    }
  }, [onLaunchTool, onLaunchProvider]);

  const isItemAvailable = (item) => {
    if (item.kind === 'tool') {
      const status = toolStatus[item.id];
      return status?.installed !== false;
    }
    if (item.kind === 'provider') {
      const cfg = providerConfigs[item.id] || {};
      return !!cfg.apiKey;
    }
    if (item.kind === 'custom-provider') {
      const cp = customProviders[item.id];
      return !!(cp && cp.apiKey);
    }
    return true;
  };

  const getItemTitle = (item) => {
    const available = isItemAvailable(item);
    const shiftHint = '\nShift+click to continue last session';
    if (item.kind === 'tool') {
      return available
        ? `Launch ${item.name}${yoloMode ? ' (YOLO)' : ''}${shiftHint}`
        : `${item.name} not installed - click to install`;
    }
    if (item.kind === 'provider') {
      return available
        ? `Launch ${item.name}${yoloMode ? ' (YOLO)' : ''}${shiftHint}`
        : `${item.name} - API Key not configured`;
    }
    if (item.kind === 'custom-provider') {
      return available
        ? `Launch ${item.name}${yoloMode ? ' (YOLO)' : ''}${shiftHint}`
        : `${item.name} - API Key not configured`;
    }
    return item.name;
  };

  const renderItem = (item) => {
    const visual = getVisualForTool(item.id, customProviders);
    const available = isItemAvailable(item);
    const isCurrent = item.id === currentToolId;

    return (
      <button
        key={item.id}
        onClick={(e) => handleSelect(item, e)}
        title={getItemTitle(item)}
        style={{
          ...dropdownStyles.item,
          opacity: available ? 1 : 0.55,
          background: isCurrent ? `${visual.color}10` : 'transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = `${visual.color}14`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = isCurrent ? `${visual.color}10` : 'transparent';
        }}
      >
        <span
          style={{
            ...dropdownStyles.itemIcon,
            color: available ? visual.color : 'var(--text-tertiary, #71717a)',
            borderColor: available ? `${visual.color}40` : 'var(--border-base, #27272a)',
            background: isCurrent ? `${visual.color}12` : 'var(--bg-button, #1a1a1e)',
          }}
        >
          <ToolIcon id={item.id} size={12} color="currentColor" />
        </span>
        <span style={{
          ...dropdownStyles.itemLabel,
          color: isCurrent ? 'var(--text-primary, #f0f0f2)' : 'var(--text-secondary, #a1a1aa)',
        }}>
          {visual.label}
        </span>
        {isCurrent && (
          <span style={dropdownStyles.currentBadge}>active</span>
        )}
        {!available && (
          <span style={dropdownStyles.warnDot} />
        )}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {/* Pinned flat buttons */}
      {pinnedItems.map((item) => (
        <PinnedButton
          key={item.id}
          item={item}
          isCurrent={item.id === currentToolId}
          customProviders={customProviders}
          onSelect={handleSelect}
        />
      ))}

      {/* Dropdown trigger — always shown for overflow or when no items */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...triggerStyles.btn,
          borderColor: open ? currentVisual.color : 'var(--border-button, #2a2a2e)',
          boxShadow: open ? `0 0 0 1px ${currentVisual.color}33, 0 4px 12px ${currentVisual.glow}` : 'none',
          background: open ? 'var(--bg-hover, #1c1c20)' : 'var(--bg-button, #1a1a1e)',
          // Narrow: only show if there are overflow items OR no installed items flat
          ...(usePinnedLayout && installedItems.length > 0 ? { display: 'none' } : {}),
        }}
        title={`Current: ${currentVisual.label}\nClick to change tool`}
      >
        <span
          style={{
            ...triggerStyles.iconBox,
            color: currentVisual.color,
            background: `${currentVisual.color}14`,
            borderColor: `${currentVisual.color}55`,
          }}
        >
          <ToolIcon id={currentToolId} size={12} color="currentColor" />
        </span>
        <span style={{ ...triggerStyles.label, color: 'var(--text-primary, #f0f0f2)' }}>
          {currentVisual.label}
        </span>
        <ChevronIcon size={10} color={open ? 'var(--text-secondary, #a1a1aa)' : 'var(--text-tertiary, #71717a)'} />
      </button>

      {/* Dropdown (portal to body to avoid split-pane clipping) */}
      {open && createPortal(
        <div ref={dropdownRef} style={{ ...getDropdownStyle(), ...dropdownStyles.wrapper }}>
          {/* Anthropic endpoints group */}
          <div style={dropdownStyles.groupHeader}>Anthropic Endpoints</div>
          <div style={dropdownStyles.groupLine} />
          {anthropicEndpoints.map(renderItem)}

          {/* Add custom endpoint button */}
          <button
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
            style={dropdownStyles.addBtn}
            title="Open settings to add custom Anthropic endpoint"
          >
            <span style={dropdownStyles.addIcon}>+</span>
            <span>Add Anthropic Endpoint</span>
          </button>

          {/* Standalone tools group */}
          <div style={{ ...dropdownStyles.groupHeader, marginTop: 6 }}>Standalone Tools</div>
          <div style={dropdownStyles.groupLine} />
          {standaloneTools.map(renderItem)}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ─── Trigger button styles ───────────────────────────────────────────────────

const triggerStyles = {
  btn: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px 4px 5px',
    border: '1px solid var(--border-button, #2a2a2e)',
    borderRadius: 7,
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    outline: 'none',
    fontFamily: 'var(--font-ui, system-ui)',
    flexShrink: 0,
    minWidth: 120,
    background: 'var(--bg-button, #1a1a1e)',
  },
  iconBox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    border: '1px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    flexShrink: 0,
  },
  label: {
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '-0.01em',
    transition: 'color 0.2s',
    whiteSpace: 'nowrap',
  },
};

// ─── Dropdown styles ─────────────────────────────────────────────────────────

const dropdownStyles = {
  wrapper: {
    minWidth: 240,
    maxHeight: 420,
    overflowY: 'auto',
    background: 'var(--bg-card, #18181b)',
    border: '1px solid var(--border-mid, #2a2a2e)',
    borderRadius: 10,
    boxShadow: '0 16px 48px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.3)',
    padding: '6px 0',
    animation: 'fade-in 0.15s ease',
  },
  groupHeader: {
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--text-tertiary, #71717a)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '8px 14px 3px',
    fontFamily: 'var(--font-ui, system-ui)',
  },
  groupLine: {
    height: 1,
    background: 'var(--border-subtle, #18181b)',
    margin: '4px 14px 2px',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '7px 14px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    transition: 'background 0.15s',
    outline: 'none',
    fontFamily: 'var(--font-ui, system-ui)',
    textAlign: 'left',
    borderRadius: 0,
  },
  itemIcon: {
    width: 22,
    height: 22,
    borderRadius: 5,
    border: '1px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  itemLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  currentBadge: {
    fontSize: 9,
    fontWeight: 600,
    color: 'var(--text-tertiary, #71717a)',
    letterSpacing: '0.04em',
    fontFamily: 'var(--font-mono, monospace)',
  },
  warnDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#ef4444',
    boxShadow: '0 0 4px rgba(239, 68, 68, 0.5)',
    flexShrink: 0,
  },
  addBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '8px 14px',
    margin: '4px 0 0',
    border: 'none',
    borderTop: '1px solid var(--border-subtle, #18181b)',
    background: 'transparent',
    color: 'var(--text-tertiary, #71717a)',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: 'var(--font-ui, system-ui)',
    transition: 'all 0.15s',
    outline: 'none',
    textAlign: 'left',
  },
  addIcon: {
    width: 18,
    height: 18,
    borderRadius: 4,
    border: '1px dashed var(--border-base, #27272a)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 500,
    flexShrink: 0,
  },
};
