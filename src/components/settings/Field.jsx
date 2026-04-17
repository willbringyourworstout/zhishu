import React from 'react';
import styles from './styles';

/**
 * Generic form field wrapper with label.
 */
export default function Field({ label, children }) {
  return (
    <div style={styles.field}>
      <label style={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}
