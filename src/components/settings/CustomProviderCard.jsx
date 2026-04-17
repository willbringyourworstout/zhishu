/**
 * CustomProviderCard — configuration card for user-defined Anthropic-format endpoints.
 *
 * Displays name, baseUrl, apiKey, model overrides, and a 12-color preset palette.
 * Used in SettingsModal's Provider tab.
 */

import React, { useState } from 'react';
import styles from './styles';
import Field from './Field';
import { PRESET_COLORS } from '../../constants/toolVisuals';

// ─── Color picker sub-component ──────────────────────────────────────────────

function ColorPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          title={c}
          type="button"
          style={{
            width: 22,
            height: 22,
            borderRadius: 4,
            background: c,
            border: value === c ? '2px solid #fff' : '2px solid transparent',
            cursor: 'pointer',
            outline: 'none',
            transition: 'border-color 0.15s',
            boxShadow: value === c ? `0 0 6px ${c}88` : 'none',
          }}
        />
      ))}
    </div>
  );
}

// ─── Main card component ─────────────────────────────────────────────────────

export default function CustomProviderCard({ provider, onUpdate, onRemove }) {
  const [showKey, setShowKey] = useState(false);

  const isConfigured = !!(provider.apiKey && provider.apiKey.trim());
  const color = provider.color || '#64748b';

  return (
    <div style={{ ...styles.providerCard, borderLeftColor: color }}>
      <div style={styles.providerHeader}>
        <div style={{
          ...styles.toolBadge,
          background: `${color}15`,
          borderColor: `${color}40`,
          color,
          fontSize: 14,
          fontWeight: 700,
        }}>
          {(provider.name || '?')[0].toUpperCase()}
        </div>
        <div style={styles.providerTitle}>
          <div style={styles.providerName}>{provider.name || 'New Endpoint'}</div>
          <div style={styles.providerSub}>
            Custom Anthropic endpoint{' '}
            {isConfigured ? (
              <span style={{ color: '#22c55e' }}>Configured</span>
            ) : (
              <span style={{ color: '#eab308' }}>API Key required</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          title="Remove endpoint"
          style={{
            background: 'transparent',
            border: '1px solid #2a1a1a',
            borderRadius: 4,
            color: '#663333',
            padding: '3px 8px',
            fontSize: 10,
            cursor: 'pointer',
            fontFamily: 'system-ui',
            flexShrink: 0,
          }}
        >
          Remove
        </button>
      </div>

      <div style={styles.providerForm}>
        <Field label="Name">
          <input
            type="text"
            value={provider.name || ''}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="My Custom Endpoint"
            style={styles.input}
          />
        </Field>

        <Field label="API Key">
          <div style={styles.keyRow}>
            <input
              type={showKey ? 'text' : 'password'}
              value={provider.apiKey || ''}
              onChange={(e) => onUpdate({ apiKey: e.target.value })}
              placeholder="sk-..."
              style={styles.input}
            />
            <button
              type="button"
              style={styles.smallBtn}
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </Field>

        <Field label="Base URL">
          <input
            type="text"
            value={provider.baseUrl || ''}
            onChange={(e) => onUpdate({ baseUrl: e.target.value })}
            placeholder="https://api.example.com/anthropic"
            style={styles.input}
          />
        </Field>

        <div style={styles.modelRow}>
          <Field label="Opus Model">
            <input
              type="text"
              value={provider.opusModel || ''}
              onChange={(e) => onUpdate({ opusModel: e.target.value })}
              placeholder="model-name"
              style={styles.input}
            />
          </Field>
          <Field label="Sonnet Model">
            <input
              type="text"
              value={provider.sonnetModel || ''}
              onChange={(e) => onUpdate({ sonnetModel: e.target.value })}
              placeholder="model-name"
              style={styles.input}
            />
          </Field>
          <Field label="Haiku Model">
            <input
              type="text"
              value={provider.haikuModel || ''}
              onChange={(e) => onUpdate({ haikuModel: e.target.value })}
              placeholder="model-name"
              style={styles.input}
            />
          </Field>
        </div>

        <Field label="Brand Color">
          <ColorPicker
            value={provider.color || '#64748b'}
            onChange={(c) => onUpdate({ color: c })}
          />
        </Field>
      </div>
    </div>
  );
}
