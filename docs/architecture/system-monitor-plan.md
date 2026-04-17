# System Resource Monitor - Architecture Plan

> Status: Draft | Date: 2026-04-18 | Author: Architect
> Scope: Real-time resource monitoring (CPU / Memory / GPU / Battery) for the entire app process tree

---

## 1. Context & Problem Statement

Users want to see real-time system resource consumption of the entire app -- including Electron main/renderer, all node-pty shells, and every AI CLI subprocess (claude, codex, gemini, etc.) -- alongside macOS battery status and estimated remaining time.

The current system already has a 1.5s BFS tick in `monitor.js` that snapshots the process table via `ps -axo pid=,ppid=,command=` for process tree traversal. This existing infrastructure is the foundation for resource monitoring.

### Key Constraints

| Constraint | Value |
|------------|-------|
| Platform | macOS only (current project scope) |
| Team size | 1 developer (solo project) |
| Delivery window | No hard deadline, but keep complexity proportional |
| Existing monitor cadence | 1.5s BFS tick in `monitor.js` |
| IPC boundary | All system calls must stay in Main process; Renderer consumes via IPC |
| Security | `execFile` only, no `exec` / `shell=True` |

---

## 2. Feasibility Assessment

### 2.1 Metric-by-Metric Analysis

| Metric | Source | Feasibility | Precision | Cost | Verdict |
|--------|--------|-------------|-----------|------|---------|
| **Process CPU %** | `ps -axo pid=,ppid=,pcpu=` | HIGH -- already calling `ps`, just add `pcpu` column | ~1% granularity, sampled over ps internal interval (~1s) | Near-zero (same syscall, one more column) | **Do it** |
| **Process Tree CPU %** | Sum `pcpu` of all descendants from BFS | HIGH -- reuse existing `collectDescendants` BFS | Accumulation of per-process samples; may exceed 100% for multi-core (expected) | Near-zero | **Do it** |
| **Electron Memory (heap)** | `process.memoryUsage()` in Main | HIGH -- zero-syscall, native Node API | Exact (rss, heapTotal, heapUsed, external) | Zero | **Do it** |
| **Process Tree Memory** | `ps -axo pid=,ppid=,rss=` | HIGH -- same ps call, add `rss` column | RSS in KB, exact per-process | Near-zero | **Do it** |
| **GPU Usage %** | No reliable Node.js API on macOS | **LOW** -- see section 2.2 | N/A | N/A | **Defer / degrade** |
| **Battery Level** | `electron.powerMonitor.getBatteryStatus()` | HIGH -- built-in Electron API | Percentage integer, accurate | Zero (event-driven) | **Do it** |
| **Battery Charging** | `powerMonitor.onBatteryPower` | HIGH -- built-in | Boolean, event-driven | Zero | **Do it** |
| **Remaining Time** | `powerMonitor.getBatteryStatus().secondsRemaining` | MEDIUM -- macOS estimates vary widely; returns -1 when charging or computing | +/- 10-30 min variance, -1 when uncertain | Zero | **Do it** (with caveats) |
| **System CPU / Memory** | `os.cpus()` + `os.totalmem()` / `os.freemem()` | HIGH -- Node built-in | Coarse (free mem snapshot) | Near-zero | **Do it** (for context) |

### 2.2 GPU Usage -- Why It Fails

| Approach | Why Not Viable |
|----------|---------------|
| `ioreg -l -w0 \| grep PerformanceStatistics` | Only reports Apple GPU (M-series), not in a standard format; requires root for detailed stats; output parsing is fragile and version-dependent |
| `system_profiler SPDisplaysDataType` | Shows hardware info, not utilization. Too slow (1-5s) for real-time |
| `sudo powermetrics --samplers gpu_power` | **Requires sudo**. Cannot ship in a consumer app |
| `node-system-monitor` / `systeminformation` npm packages | Both shell out to `system_profiler` or `ioreg` internally; same limitations |
| `CGDirectDisplayID` / Metal Performance Shaders | Requires native Objective-C/Swift addon; massive implementation cost for a solo project |
| Electron `webContents.gpuInfo` | Only shows GPU feature flags and driver info, not utilization |

**Conclusion**: GPU utilization percentage is not practically obtainable in a macOS Electron app without sudo or a native addon. This metric should be deferred or replaced with an indirect indicator.

**Degradation path**: Show GPU memory allocation if the WebGL addon is active (from `gl.getParameter` in renderer), or simply note "GPU: WebGL active" vs "GPU: Canvas fallback". This gives the user a binary indicator without trying to measure utilization.

---

## 3. Recommended Architecture

### 3.1 Design Principles

1. **Extend, don't duplicate**: Reuse the existing `ps -axo` call in `monitor.js` by adding `pcpu=,rss=` columns
2. **Single tick**: Resource collection piggybacks on the 1.5s monitor tick -- no additional polling interval
3. **Push model**: Main process broadcasts resource data to renderer via a single IPC channel, not pull/request
4. **Process tree aggregation**: Sum CPU% and RSS for the entire Electron app tree (main + renderer + all pty shells + all AI CLI children)

### 3.2 Data Flow

```
                 Main Process (1.5s tick)
                 ┌─────────────────────────────────────────┐
                 │                                         │
  monitor.js     │  snapshotProcesses()                    │
  (extend)       │  ps -axo pid=,ppid=,command=,pcpu=,rss=│
                 │         │                               │
                 │         v                               │
                 │  Build per-tree aggregates:             │
                 │    { cpu%, rss, pidCount }              │
                 │         │                               │
                 │         +  process.memoryUsage()        │
                 │         +  os.freemem() / os.totalmem()│
                 │         +  os.cpus() load averages      │
                 │         +  powerMonitor.getBatteryStatus()│
                 │         │                               │
                 │         v                               │
  preload.js     │  webContents.send('system:resources')   │
                 └──────────┬──────────────────────────────┘
                            │
                 ┌──────────v──────────────────────────────┐
                 │        Renderer Process                  │
                 │                                         │
  Zustand store  │  updateSystemResources(payload)         │
                 │    → systemResources: { cpu, mem, bat }  │
                 │         │                               │
                 │         v                               │
  ResourceBar    │  <ResourceBar resources={...} />        │
  (new comp)     │  Placed inside TerminalView monitorBar  │
                 └─────────────────────────────────────────┘
```

### 3.3 Resource Payload Shape

```js
{
  // Timestamp of this sample
  ts: number,

  // Application process tree
  app: {
    cpuPercent: number,       // Sum of pcpu across all descendants
    memoryMB: number,         // Sum of RSS across all descendants (MB)
    pidCount: number,         // Number of processes in tree
    // Electron main process heap (from process.memoryUsage())
    heapUsedMB: number,
    heapTotalMB: number,
  },

  // System-wide context
  system: {
    cpuCount: number,         // os.cpus().length
    cpuLoadAverage: number,   // 1-min load average / cpu count (0-1 scale)
    totalMemoryGB: number,    // os.totalmem() / 1GB
    freeMemoryGB: number,     // os.freemem() / 1GB
    usedMemoryPercent: number,// (1 - free/total) * 100
  },

  // Battery (macOS only, from Electron powerMonitor)
  battery: {
    present: boolean,         // Has battery at all (desktop Macs = false)
    charging: boolean,        // Is currently charging
    level: number,            // 0-100 percent
    remainingMinutes: number | null,  // null when charging or computing
  },
}
```

### 3.4 Key Implementation Details

#### 3.4.1 CPU Collection -- Extend ps call

The current `snapshotProcesses()` in `monitor.js` calls:
```
ps -axo pid=,ppid=,command=
```

Change to:
```
ps -axo pid=,ppid=pcpu=,rss=
```

Wait -- `pcpu` from `ps` reports CPU percentage **since process start** (accumulated average), not instantaneous. For real-time CPU, we need two samples and compute delta.

**Revised approach**: Use `ps -axo pid=,ppid=,time=,rss=,command=` where `time` is accumulated CPU time. Between two ticks (1.5s apart), delta-time / wall-time gives actual CPU%.

```
cpuPercent = (time_new - time_old) / tickInterval_seconds * 100
```

The `time` field format from ps is `MM:SS.ss` or `HH:MM:SS.ss` -- needs parsing.

Alternatively, `pidusage` (npm package) handles this internally but adds a dependency. Given this is a solo project, the simpler approach is:

**Final decision**: Parse `ps -axo pid=,ppid=,time=,rss=,command=` and compute delta-CPU between consecutive ticks. Store previous tick's `time` values in a module-level Map.

#### 3.4.2 Process Tree Aggregation

The app's process tree root is `process.pid` (Electron main). Collect all descendants via BFS (same algorithm already in `collectDescendants`). For each session's pty, also collect its descendants (already done in `findActiveAITool`).

Two views:
- **Whole-app aggregate**: Sum all descendants of `process.pid`
- **Per-session breakdown** (future): Sum descendants of each pty's shell PID

**V1 scope**: Whole-app aggregate only. Per-session breakdown is YAGNI until users ask.

#### 3.4.3 Battery -- Electron powerMonitor

```js
const { powerMonitor } = require('electron');

// Available after app.whenReady()
powerMonitor.getBatteryStatus()
// Returns: { charging: boolean, level: number, secondsRemaining: number|null }
```

Notes:
- `secondsRemaining` is -1 when charging or when macOS hasn't computed an estimate yet
- `level` is 0-100 integer
- `powerMonitor.on('on-battery', () => {})` and `powerMonitor.on('on-ac', () => {})` for change events
- On desktop Macs (Mac mini, Mac Studio, iMac): returns `{ charging: true, level: 100, secondsRemaining: -1 }` or similar. Detect "no battery" by checking if `level` stays at 100 and `secondsRemaining` is always -1.

#### 3.4.4 Memory -- RSS vs Heap

- **RSS (Resident Set Size)**: From `ps`, includes shared libraries, memory-mapped files, GPU textures. This is what Activity Monitor shows. Use for process tree aggregation.
- **Heap**: From `process.memoryUsage()`, only V8 JavaScript heap. Use for understanding JS memory pressure internally.

Display both but prioritize RSS for the user-facing display, since it matches what Activity Monitor shows.

---

## 4. Performance Impact Analysis

| Operation | Frequency | Latency | CPU Cost |
|-----------|-----------|---------|----------|
| `ps -axo` (extended) | 1.5s | ~10-30ms | <0.1% (kernel does the work) |
| `process.memoryUsage()` | 1.5s | <1ms | Negligible |
| `os.freemem()` / `os.totalmem()` | 1.5s | <1ms | Negligible |
| `powerMonitor.getBatteryStatus()` | 1.5s | <1ms | Negligible |
| Parse ps output + BFS | 1.5s | ~1-5ms | Negligible |
| IPC send to renderer | 1.5s | <1ms | Negligible |
| **Total per tick** | | **~15-40ms** | **<0.3%** |

The existing `ps` call already runs every 1.5s. Adding two more columns (`time=,rss=`) increases output size by ~30% but the parse cost remains trivial. No additional syscalls or child processes are introduced.

**No additional child process needed.** Everything piggybacks on the existing monitor tick.

---

## 5. UI Placement

### 5.1 Recommended Location: TerminalView Monitor Bar (Expanded)

The existing monitor bar in `TerminalView.jsx` (line ~989) already shows SESSION / STATUS / LAST / CWD. The resource monitor fits naturally as additional segments in this bar.

```
Existing:  SESSION 12m 30s | STATUS [claude running 2m 15s] | LAST codex 1m 02s |          ▸ ~/project
                                                                                       ↑ spacer
Proposed:  SESSION 12m 30s | STATUS [claude running] | CPU 23.5% | MEM 1.2 GB | BAT 87% 2h 30m | ▸ ~/project
```

**Why here**:
- User is already looking at this bar for session status
- No new UI surface area needed -- just more segments in the existing bar
- Natural spatial grouping: session info on the left, system info on the right
- Does not clutter the toolbar (which has tool launch buttons)
- Works in both single-session and split-pane modes (each TerminalView has its own bar)

### 5.2 Alternative Locations Considered (and Rejected)

| Location | Why Rejected |
|----------|-------------|
| New floating panel | Over-engineering for what is essentially 3-4 numbers; adds open/close toggle complexity |
| Sidebar footer | Sidebar is about navigation; resource data is contextual to the active terminal |
| macOS menu bar (Tray tooltip) | Too hidden; users don't hover tray icons for real-time data |
| Settings modal | Not real-time; wrong interaction pattern |

### 5.3 Resource Bar Segments (Detail)

```
+--------+--------+---------+----------+----------+-----------+---------+
| CPU    | MEM    | HEAP    | SYS MEM  | BATTERY  |           | CWD     |
| 23.5%  | 1.2 GB | 312 MB  | 68% used | 87% 2:30 |           | ▸ ~proj |
+--------+--------+---------+----------+----------+-----------+---------+
```

Segment visibility rules:
- **CPU**: Always visible (core metric)
- **MEM** (RSS): Always visible (core metric)
- **HEAP**: Hidden by default, shown on hover or when memory > 2GB (anomaly detection)
- **SYS MEM**: Hidden by default, shown as subtle background color change on the MEM segment when system is >85% used
- **BATTERY**: Only visible when on battery power (powerMonitor.onBatteryPower). Show level + remaining time. When charging, show a small charging icon and percentage.

### 5.4 Visual Treatment

Follow existing monitor bar conventions:
- Label: 9px, `#333`, 700 weight, 0.1em letter-spacing (same as `monitorLabel`)
- Value: 11px, `#b0b0b0`, 500 weight, tabular-nums (same as `monitorValue`)
- Dividers: 1px wide, `#1a1a1a` (same as `monitorDivider`)
- Color coding: CPU >80% = amber, MEM >80% = amber, Battery <20% = red

---

## 6. Degradation Strategy

| Scenario | Degradation |
|----------|-------------|
| GPU utilization | **Not implemented in V1**. Show "GPU: WebGL" or "GPU: Canvas" as a static label in the monitor bar, derived from whether WebglAddon loaded successfully. No percentage. |
| `ps` command fails | Return last known values with a staleness indicator (timestamp check). After 3 consecutive failures, show "--" for CPU/MEM. |
| `powerMonitor` unavailable | Hide battery segment entirely. This can happen on very old Electron versions or non-macOS platforms. |
| `secondsRemaining` is -1 | Show "Charging" when charging, "Computing..." when first unplugged (macOS needs ~30s to estimate). Never show "0:00". |
| High process count (>500) | `ps` output is already guarded with maxBuffer checks. Resource aggregation skips processes it cannot parse. |
| Window is not focused | Resource collection continues (AI tools run in background), but Renderer could throttle re-renders to 5s when hidden. |

---

## 7. File Changes

### 7.1 New Files

| File | Responsibility |
|------|---------------|
| `electron/resourceMonitor.js` | Resource collection logic: extend ps output, compute CPU deltas, aggregate process tree, read battery status. Called from monitor tick. |
| `src/components/ResourceBar.jsx` | React component rendering the resource segments in the monitor bar. Consumes `systemResources` from Zustand store. |

### 7.2 Modified Files

| File | Change | Risk |
|------|--------|------|
| `electron/monitor.js` | Import `collectResourceSnapshot` from `resourceMonitor.js`. Call it inside `monitorTick()` and broadcast result via `webContents.send('system:resources', payload)`. Extend `snapshotProcesses()` to include `time=,rss=` columns. | LOW -- additive change, no existing behavior modified |
| `electron/preload.js` | Add `onSystemResources(callback)` IPC listener: `ipcRenderer.on('system:resources', handler)` returning unsubscribe fn. | LOW -- additive |
| `electron/main.js` | Initialize `powerMonitor` listener after `app.whenReady()`. Pass `powerMonitor` reference to resourceMonitor module. | LOW -- additive |
| `src/store/sessions.js` | Add `systemResources` state field and `updateSystemResources()` action. Add `initSystemResourcesSubscription()` called from `init()`. | LOW -- additive |
| `src/components/TerminalView.jsx` | Import `ResourceBar` component. Render inside `monitorBar` div, replacing the spacer. Pass `systemResources` from store. | LOW -- UI composition change |
| `src/components/Sidebar.jsx` | Optionally show a tiny battery icon in the sidebar header when on battery power. Optional, can defer. | VERY LOW |

### 7.3 No Changes Needed

| File | Why |
|------|-----|
| `electron/pty.js` | Resource collection does not modify pty state maps |
| `electron/git.js`, `fs-handlers.js`, `tools.js` | Unrelated |
| `src/App.jsx` | Subscription is managed in the Zustand store init, not in App |

---

## 8. ADR: Architecture Decision Record

### ADR-001: Extend Existing ps Call vs Separate Resource Collection

**Decision**: Extend the existing `ps -axo` call in `monitor.js` to include `time=,rss=` columns rather than creating a separate polling loop.

**Rationale**:
- The 1.5s tick already exists and runs `ps`
- Adding 2 columns to an existing `ps` invocation is cheaper than a second `ps` invocation
- Single tick = single coherent snapshot = no timestamp skew between process tree and resource data

**Trade-off**: The monitor tick gets slightly heavier (more parsing). But the cost is dominated by the `ps` syscall itself, not the parsing.

**Overturn condition**: If resource monitoring needs a different cadence (e.g., 5s for battery, 0.5s for CPU), split into two intervals. But current 1.5s is a good compromise for all metrics.

### ADR-002: Whole-App Aggregate vs Per-Session Breakdown

**Decision**: V1 shows only the whole-app process tree aggregate. Per-session resource breakdown is deferred.

**Rationale**:
- Per-session breakdown requires associating each AI CLI process back to its session, which is fragile (process tree can be deep and variable)
- Users primarily want to know "is my machine struggling" -- a single number answers this
- YAGNI: no user request for per-session breakdown yet

**Overturn condition**: If users specifically ask "which session is using the most memory", implement per-session breakdown. The data is already collected (per-PID RSS/CPU in the ps output), just needs aggregation grouping.

### ADR-003: No New Dependencies

**Decision**: Do not add `pidusage`, `systeminformation`, or any npm package for resource monitoring.

**Rationale**:
- `ps` is already available and called; extending it is trivial
- `process.memoryUsage()` and `os` module are built-in
- `powerMonitor` is built into Electron
- Every npm dependency is a supply chain risk and maintenance burden for a solo project

**Overturn condition**: If the project adds multi-platform support (Linux/Windows) where `ps` output differs, consider `systeminformation` as a cross-platform abstraction. But for macOS-only, raw `ps` is simpler and more transparent.

---

## 9. Implementation Sequence (for dev-lead)

This is the **recommended order**, not a step-by-step implementation guide. Dev-lead decides the internal approach.

### Phase 1: Data Collection (Main Process)
1. Create `electron/resourceMonitor.js` with `collectResourceSnapshot(byPid)` function
2. Extend `snapshotProcesses()` in `monitor.js` to add `time=,rss=` columns
3. Add delta-CPU computation with previous-tick storage
4. Add `powerMonitor` initialization in `main.js`
5. Broadcast resource payload via `webContents.send('system:resources', payload)`

### Phase 2: IPC Bridge
6. Add `onSystemResources(callback)` to `preload.js`

### Phase 3: State Management
7. Add `systemResources` field and `updateSystemResources()` to Zustand store
8. Subscribe to `onSystemResources` IPC in store init

### Phase 4: UI
9. Create `ResourceBar.jsx` component
10. Integrate into `TerminalView.jsx` monitor bar
11. Add color coding for thresholds (CPU >80%, MEM >80%, Battery <20%)

### Phase 5: Polish
12. Add GPU status indicator (static: "WebGL" / "Canvas")
13. Handle edge cases (ps failure, no battery, stale data)
14. Test with multiple AI CLI sessions running simultaneously

---

## 10. Testing Strategy

| What | How |
|------|-----|
| `ps` output parsing | Unit test with fixture ps output (add to `electron/resourceMonitor.test.js`) |
| CPU delta computation | Unit test with two consecutive tick data points |
| Process tree aggregation | Unit test with mock byPid Map |
| Battery handling | Manual test (unplug laptop, observe) |
| Performance | Verify monitor tick stays under 50ms with 10+ sessions |
| UI rendering | Visual verification in development mode |

---

## 11. Open Questions (for pm / dev-lead)

1. **Should per-session resource breakdown be in scope?** Current recommendation: no. But if the user's intent was "see how much each AI tool costs", we need it.
2. **Should historical resource data be persisted?** E.g., "peak CPU in the last hour". Current recommendation: no, YAGNI.
3. **Should the resource bar be collapsible?** Current recommendation: no, it's in the existing monitor bar which is already minimal. But if users find it noisy, add a settings toggle.

---

*End of document*
