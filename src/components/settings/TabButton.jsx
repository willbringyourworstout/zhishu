import React from 'react';
import styles from './styles';

/**
 * Tab button used in the settings modal tab bar.
 * Highlights with amber bottom border when active.
 */
export default function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.tab,
        color: active ? '#e2e8f0' : '#555',
        borderBottomColor: active ? '#f59e0b' : 'transparent',
      }}
    >
      {children}
    </button>
  );
}
