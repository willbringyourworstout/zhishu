# Split Pane Architecture Design

> Author: architect | Date: 2026-04-13 | Scope: v1.2.0 terminal split-screen

## 1. Executive Summary

This document defines the architecture for adding split-pane terminal views to ZhiShu. After analyzing the current codebase, the recommended approach is **"multi-session side-by-side"** rather than "true split of one session." This means users can display two existing sessions' terminals simultaneously within the same window, without any changes to pty management or IPC layer.

**Core principle**: The split pane is a pure layout-layer concern. No changes to `electron/pty.js`, `electron/monitor.js`, or any main-process module. No new IPC channels. All changes live in the renderer's store and components.

---

## 2. Recommended Approach: Multi-Session Side-by-Side

### 2.1 What It Is

Users can drag a session from the Sidebar into the terminal area to create a split. The split displays **two different sessions** side by side (or top/bottom). Each session keeps its own pty, toolbar, monitor bar, and xterm instance -- they are completely independent.

### 2.2 What It Is NOT

- NOT splitting one session into two views of the same terminal output
- NOT creating a new session when splitting (the user selects an existing one)
- NOT a tiling window manager with arbitrary nested splits

### 2.3 Why This Approach

| Factor | Assessment |
|--------|-----------|
| **Pty layer impact** | Zero. Each session already has its own pty. No changes to `electron/pty.js`. |
| **IPC layer impact** | Zero. No new IPC channels needed. The existing `pty:data:{id}` per-session channels already handle independent streams. |
| **WebGL context** | Each session already has its own xterm + WebGL addon. No sharing, no dispose race conditions. |
| **Data model** | Small addition to store: a `splitPane` field on the active layout. |
| **Complexity** | Low-medium. Primarily CSS layout work + one new store field + a drop handler. |

### 2.4 ADR-001: Side-by-Side vs True Split

**Decision**: Multi-session side-by-side (display two different sessions).

**Alternative considered**: True split -- one session's output mirrored in two panes. This would require either:
- A multiplexer in the main process to fan-out `pty:data` to two listeners
- A shared xterm instance with viewport splitting (not supported by xterm.js)

**Why rejected**: 
- Adds main-process complexity for a marginal use case
- xterm.js does not natively support viewport splitting
- Users already have multiple sessions -- the real value is seeing two at once

**Reversal condition**: If user research shows strong demand for "watch one AI's output in two views simultaneously," revisit. Implementation path: add a `pty:data` fan-out in `electron/pty.js`.

---

## 3. Data Model Changes

### 3.1 Store Addition (`src/store/sessions.js`)

Add a single new field to the Zustand store:

```javascript
// Split pane state: null when no split, object when split is active
splitPane: null,
// Schema when active:
// {
//   sessionId: string,        // The secondary session displayed alongside activeSessionId
//   direction: 'horizontal',  // 'horizontal' (left-right) or 'vertical' (top-bottom)
//   ratio: 0.5,              // Initial split ratio (0.0 - 1.0), adjustable by drag
// }
```

This is deliberately flat, not a recursive tree structure. We support exactly two panes -- no nested splits for v1.2.0.

### 3.2 New Store Actions

```javascript
// Open a split with an existing session
openSplit: (sessionId, direction = 'horizontal') => { ... },

// Close the split (secondary pane dismissed)
closeSplit: () => { ... },

// Update split ratio (during drag)
setSplitRatio: (ratio) => { ... },

// Persist the split ratio after drag ends
commitSplitRatio: () => { ... },

// Swap primary and secondary sessions
swapSplitSessions: () => { ... },
```

### 3.3 Persistence

`splitPane` is NOT persisted to `~/.ai-terminal-manager.json`. Split state is transient -- it resets on app restart. Rationale:
- Sessions may be added/removed between launches
- Split is a temporary workspace arrangement, not a permanent layout
- Avoids complexity of validating persisted split references

### 3.4 Interaction with Existing State

- `activeSessionId` still determines which session is "primary" (has focus, receives keyboard input)
- When a pane is clicked, that session becomes `activeSessionId`
- The other session in the split is the `splitPane.sessionId`
- Closing either session via Cmd+W closes only that session; if it was the split partner, the split closes too
- `isActive` prop on TerminalView becomes true for the focused pane only

---

## 4. Rendering Architecture

### 4.1 Current Layout (Single Session)

```
App.jsx
  main
    termStack (position: relative)
      termLayer (position: absolute, inset: 0)  ← one per session, stacked
        TerminalView
          wrapper (flex column)
            dragBar
            toolbar
            monitorBar
            contentRow (flex row)
              terminalColumn (flex 1)
              panelColumn (conditional)
```

### 4.2 New Layout (Split Active)

```
App.jsx
  main
    SplitContainer (new, replaces termStack when split active)
      ├─ SplitPane (flex, width = ratio%)
      │    TerminalView (primary session)
      ├─ SplitDivider (drag handle, 4px)
      └─ SplitPane (flex, width = (1-ratio)%)
           TerminalView (secondary session)

    termStack (position: relative)  ← still present for non-split sessions
      termLayer (position: absolute, inset: 0, visibility: hidden)
        TerminalView (inactive sessions, kept alive)
```

**Key insight**: When split is active, the two sessions in the split are rendered by `SplitContainer`, NOT by `termStack`. All other sessions remain in `termStack` with `visibility: hidden` (existing behavior). When the split closes, both sessions go back into `termStack`.

### 4.3 Component Tree

No changes to `TerminalView.jsx` itself. It already handles independent xterm lifecycle per session. The split container is a new component that simply renders two `TerminalView` instances side by side.

New component: `src/components/SplitContainer.jsx`

```
SplitContainer
  props: { primaryId, secondaryId, direction, ratio, onRatioChange, onClose, onSwap, onPaneFocus }
  renders:
    SplitPane(primaryId) + SplitDivider + SplitPane(secondaryId)
```

### 4.4 z-index and Focus

- Both panes in `SplitContainer` are always `visibility: visible`
- The focused pane gets a subtle border highlight (e.g. `borderColor: '#333'` vs `#1a1a1a`)
- Clicking a pane calls `setActiveSession(sessionId)` -- standard focus behavior
- The unfocused pane's terminal does NOT receive keyboard events (xterm `focus()` is not called)

### 4.5 TerminalView `isActive` Prop

Currently `isActive` controls:
1. Window focus restoration (`term.focus()` on window focus event)
2. Session switch focus (`term.focus()` when isActive becomes true)

With split, `isActive` should be true for the focused pane only. Both terminals are visible, but only one receives input at a time. This matches the current behavior -- no logic change needed in TerminalView.

---

## 5. Interaction Design

### 5.1 Opening a Split

**Primary method**: Drag a session from Sidebar to terminal area.

1. User starts dragging a session row in Sidebar
2. Sidebar sets `dataTransfer.setData('application/x-zhishu-session', sessionId)`
3. Terminal area (or a dedicated drop zone) accepts the drop
4. If no split exists: `openSplit(sessionId, 'horizontal')`
5. If split already exists: replace the secondary session with the dropped one

**Alternative method**: Right-click context menu on a session row -> "Split Right" / "Split Down"

### 5.2 Closing a Split

**Methods**:
1. Close button (X) on the secondary pane's toolbar area
2. Cmd+W when the secondary pane is focused (standard session close -- closes the session entirely)
3. Right-click on a pane -> "Close Split" (closes the split view, does NOT close the session)

### 5.3 Resizing the Split

- A 4px drag handle between panes (similar to existing panel resizer)
- Cursor changes to `col-resize` (horizontal) or `row-resize` (vertical) on hover
- During drag, update `splitPane.ratio` in store
- On mouse up, persist via `commitSplitRatio()` (debounced, no config persistence needed)
- Both panes' xterm FitAddon fires via ResizeObserver -- automatic terminal resize

### 5.4 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+\` | Toggle split (open with last-used secondary session, or close) |
| `Cmd+Shift+\` | Swap primary and secondary |
| `Cmd+Alt+Arrow` | Move focus between panes |

### 5.5 Focus Management

- Clicking any pane focuses it (calls `setActiveSession`)
- The focused pane shows a subtle visual indicator (slightly brighter border)
- Terminal input goes to the focused pane only
- Toast notifications reference the correct session regardless of focus

---

## 6. Constraints and Edge Cases

### 6.1 Minimum Pane Width

Each pane must have a minimum width of 350px (terminal content becomes unusable below this). If the window is resized below 700px total, auto-close the split.

### 6.2 Session Deletion

If a session in the split is deleted:
- If it's the secondary session: close the split, primary continues
- If it's the primary (active) session: close the split, the remaining session becomes active

### 6.3 Panel (Git/FileTree) Interaction

When a panel (Git or FileTree) is open:
- It attaches to the focused pane's session (current behavior)
- Both panes shrink proportionally to make room
- The panel resizer works independently of the split resizer

### 6.4 WebGL Context Limits

Each xterm instance with WebGL addon uses one WebGL context. Browsers typically support 8-16 active WebGL contexts. With split (2 visible) + background sessions (visibility: hidden but not display:none), we should be fine. The existing architecture already handles this -- sessions in `termStack` with `visibility: hidden` still have active WebGL contexts but don't render frames (no GPU cost).

### 6.5 Window Resize

On window resize, both panes' ResizeObserver instances fire. Each independently calls `fitAddon.fit()` and `resizePty()`. No coordination needed -- each session has its own pty and resize channel.

---

## 7. File Change List

### 7.1 New Files

| File | Purpose | Estimated Lines |
|------|---------|----------------|
| `src/components/SplitContainer.jsx` | Split layout container with drag handle | ~180 |

### 7.2 Modified Files

| File | Changes | Estimated Effort |
|------|---------|-----------------|
| `src/store/sessions.js` | Add `splitPane` state + 5 new actions (`openSplit`, `closeSplit`, `setSplitRatio`, `commitSplitRatio`, `swapSplitSessions`) | ~40 lines added |
| `src/App.jsx` | Conditionally render `SplitContainer` vs `termStack` based on `splitPane` state; add drop handler for session drag | ~30 lines changed |
| `src/components/Sidebar.jsx` | Add `draggable` to session rows; set `application/x-zhishu-session` data on drag start | ~10 lines |
| `src/components/TerminalView.jsx` | No functional changes. Optionally add a visual focus indicator for split mode (border highlight) | ~5 lines (optional) |

### 7.3 Unchanged Files

All main-process files (`electron/pty.js`, `electron/main.js`, `electron/monitor.js`, etc.) and `electron/preload.js` are **unchanged**. No new IPC channels. No pty management changes.

---

## 8. Complexity Assessment

### 8.1 Scope for v1.2.0

| Dimension | Rating | Reasoning |
|-----------|--------|-----------|
| Data model | Low | Single flat field, no nesting |
| Rendering | Medium | New container component, drag handle, CSS layout |
| Interaction | Medium | Drop handler, focus management, resize |
| Main process | Zero | No changes |
| Testing | Low | Only renderer-side logic, no pty dependencies |
| Risk | Low | No xterm lifecycle changes, no WebGL dispose concerns |

**Verdict: Suitable for v1.2.0.** The scope is well-contained -- one new component, one store field, zero main-process changes. Estimated 1-2 days of focused development.

### 8.2 What We Explicitly Defer

| Feature | Why Deferred | Revisit When |
|---------|-------------|-------------|
| Vertical split (top/bottom) | Layout CSS is straightforward but terminal height below 200px is nearly unusable. Most real value is horizontal. | User requests it |
| Nested splits (3+ panes) | Requires tree-based layout model, significantly more complex. Recursive split container. | Clear power-user demand |
| Split state persistence | Transient workspace, adds config validation complexity for minimal gain | Users report wanting persistent layouts |
| Session-internal split (same session, two views) | Requires pty output multiplexing, not worth the architectural cost | User research proves strong need |

---

## 9. Implementation Sequence for dev-lead

1. **Store changes first** (`sessions.js`): Add `splitPane` field + actions. This is the foundation.
2. **SplitContainer component** (`SplitContainer.jsx`): Build the layout shell with two terminal slots and a drag handle.
3. **App.jsx integration**: Wire `SplitContainer` into the render tree, conditionally replacing `termStack`.
4. **Sidebar drag source** (`Sidebar.jsx`): Add draggable session rows with custom MIME type.
5. **Focus and polish**: Pane focus indicator, keyboard shortcuts, edge case handling.

---

## 10. Architecture Decision Records

### ADR-002: Flat splitPane vs Recursive Tile Tree

**Context**: How to model the split layout in state?

**Options**:
- A) Flat: `splitPane: { sessionId, direction, ratio }` -- exactly two panes
- B) Tree: `layout: { type: 'split', children: [...], direction, ratios: [...] }` -- arbitrary nesting

**Decision**: Option A (flat).

**Rationale**:
- The task description asks for split pane, not a tiling WM
- Flat model is trivially serializable and debuggable
- Recursive tree requires a recursive renderer, resize algorithm, and focus traversal -- 3x the code
- YAGNI: no user has asked for 3+ panes yet

**Reversal condition**: If we need 3+ panes, migrate `splitPane` to a tree model. The `SplitContainer` component would become recursive. Store migration: wrap the flat object in `{ type: 'leaf', ... }` nodes.

### ADR-003: No Main-Process Changes

**Context**: Should split pane require any changes to pty management?

**Decision**: No. The split is purely a renderer layout concern.

**Rationale**:
- Each session already has independent pty, IPC channels, and monitoring
- xterm instances are already mounted simultaneously (all sessions in `termStack`)
- The only difference is CSS: two are `visibility: visible` instead of one

**Cost**: None.

**Reversal condition**: Only if we want "same session, two views" -- which requires pty output multiplexing in the main process.

### ADR-004: Split State is Transient

**Context**: Should split layout persist across app restarts?

**Decision**: No. `splitPane` is not saved to config.

**Rationale**:
- Session IDs may not exist on next launch (user can delete sessions)
- Split arrangement is workspace context, not configuration
- Avoids validation complexity ("the saved split session no longer exists")

**Reversal condition**: If users consistently re-create the same split after restart, add persistence with validation. Implementation: save `splitPane` in config, validate on `init()` that both sessions exist.

---

## 11. Visual Reference

### Before Split (Current)

```
+---+----------------------------------------+
| S |  [toolbar: Claude | Codex | ... ]      |
| i |  [monitor: SESSION 42m | STATUS idle]  |
| d |  +------------------------------------+|
| e |  |                                    ||
| b |  |         Terminal Output            ||
| a |  |         (single session)           ||
| r |  |                                    ||
|   |  +------------------------------------+|
+---+----------------------------------------+
```

### After Split (New)

```
+---+--------------------+-------------------+
| S |  [toolbar]          |  [toolbar]        |
| i |  [monitor]          |  [monitor]        |
| d |  +----------------++------------------+|
| e |  |                ||                  ||
| b |  |  Terminal A    ||  Terminal B      ||
| a |  |  (Claude)      ||  (Codex)         ||
| r |  |                ||                  ||
|   |  +----------------++------------------+|
+---+--------------------+-------------------+
                      ^ drag handle (4px)
```

### Drop Interaction

```
+---+--------------------+-------------------+
| S |                    |                   |
| i |  [SESSION ROW] ←─── drag to here       |
| d |                    |                   |
| e |  Terminal A        |  Terminal B       |
| b |  (active)          |  (from sidebar)   |
| a |                    |                   |
| r |                    |                   |
+---+--------------------+-------------------+
```

---

*End of split pane architecture design.*
