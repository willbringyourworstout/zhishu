import React, { useState, useRef, useEffect } from 'react';
import styles from './styles';

// ─── Inline editable label (double-click to edit) ────────────────────────────

function EditableLabel({ value, onCommit, style }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== value) onCommit(draft.trim());
    else setDraft(value);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setEditing(false); setDraft(value); }
        }}
        style={styles.inlineInput}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <span style={style} onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}>
      {value}
    </span>
  );
}

export default React.memo(EditableLabel);
