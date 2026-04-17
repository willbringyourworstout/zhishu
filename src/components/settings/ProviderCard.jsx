import React, { useState } from 'react';
import styles from './styles';
import Field from './Field';

/**
 * Provider configuration card with API key, base URL, and model overrides.
 */
export default function ProviderCard({ provider, config, onUpdate, color }) {
  const [showKey, setShowKey] = useState(false);
  const cfg = {
    apiKey: config.apiKey || '',
    baseUrl: config.baseUrl || provider.defaults.baseUrl,
    opusModel: config.opusModel || provider.defaults.opusModel,
    sonnetModel: config.sonnetModel || provider.defaults.sonnetModel,
    haikuModel: config.haikuModel || provider.defaults.haikuModel,
  };

  const isConfigured = !!cfg.apiKey;

  return (
    <div style={{ ...styles.providerCard, borderLeftColor: color }}>
      <div style={styles.providerHeader}>
        <div style={{ ...styles.toolBadge, background: `${color}15`, borderColor: `${color}40`, color }}>
          {provider.name[0]}
        </div>
        <div style={styles.providerTitle}>
          <div style={styles.providerName}>{provider.name}</div>
          <div style={styles.providerSub}>
            基于 {provider.baseTool} · {isConfigured ? (
              <span style={{ color: '#22c55e' }}>● 已配置</span>
            ) : (
              <span style={{ color: '#eab308' }}>⚠ 未配置 API Key</span>
            )}
          </div>
        </div>
      </div>

      <div style={styles.providerForm}>
        <Field label="API Key">
          <div style={styles.keyRow}>
            <input
              type={showKey ? 'text' : 'password'}
              value={cfg.apiKey}
              onChange={(e) => onUpdate({ apiKey: e.target.value })}
              placeholder="sk-..."
              style={styles.input}
            />
            <button
              type="button"
              style={styles.smallBtn}
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
        </Field>

        <Field label="Base URL">
          <input
            type="text"
            value={cfg.baseUrl}
            onChange={(e) => onUpdate({ baseUrl: e.target.value })}
            style={styles.input}
          />
        </Field>

        <div style={styles.modelRow}>
          <Field label="Opus Model">
            <input
              type="text"
              value={cfg.opusModel}
              onChange={(e) => onUpdate({ opusModel: e.target.value })}
              style={styles.input}
            />
          </Field>
          <Field label="Sonnet Model">
            <input
              type="text"
              value={cfg.sonnetModel}
              onChange={(e) => onUpdate({ sonnetModel: e.target.value })}
              style={styles.input}
            />
          </Field>
          <Field label="Haiku Model">
            <input
              type="text"
              value={cfg.haikuModel}
              onChange={(e) => onUpdate({ haikuModel: e.target.value })}
              style={styles.input}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}
