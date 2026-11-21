# ActivityReel — Architecture & Module Contracts (v1)

Status: implementation contract. Grounded in `docs/PROJECT.md`, `docs/design/ui-spec.md`,
and the research reports under `docs/research/`. API availability was confirmed by
`docs/research/algorithms-and-apis.md` on 2026-11-21; supervisor decisions that override a
research recommendation are marked **SUPERVISOR**.

Target: `engines.vscode = ^1.93.0` (first stable with terminal shell-integration events), so no
runtime feature gates are required; terminal events stay defensive because shell integration may
be unavailable per shell.

## 1. Product constraints that drive the architecture

- Observer only: never modifies documents; works with any editor/agent.
- Live from window start: keep `onStartupFinished`; `activate()` must be cheap and config-gated.
- Local-only: no network, no telemetry; CSP denies remote content.
- Beautiful and native: theme variables only, RTL-safe, accessible, motion-reduced.
- Works with large workspaces: caps everywhere, virtualized UI, batched IPC.

## 2. System overview

```
VS Code events ──► Tracker layer ──► ActivityStore ──► Persistence (workspace storage)
                        │                 │                    │
                        │                 ├─ metadata for UI   │
                        │                 └─ diff payloads     │
                        ▼                 ▼                    ▼
                 DiffEngine ◄──── WebviewHost ◄──── Panel / Sidebar / About webviews
                                        │
                                   Commands, StatusBar, Export
```

Single extension-side store is the source of truth. Each webview has its own React state,
hydrated from `init` and updated by batched messages. Webviews never share memory.

## 3. Repository layout

```
package.json                  manifest (main: ./dist/extension.js)
esbuild.config.mjs            extension-host bundle -> dist/extension.js
vite.config.mts               webview IIFE bundle -> media/webview/main.js, main.css (fixed names)
tsconfig.json                 base
tsconfig.extension.json       src + test/integration (node, vscode)
tsconfig.webview.json         webview + src/shared (DOM)
src/
  extension.ts                activate/deactivate, wiring only
  shared/                     environment-neutral types (no `vscode` import)
    model.ts                  events, diffs, stats, settings, filters
    protocol.ts               HostMessage / WebviewMessage unions
    constants.ts              defaults, limits, storage keys
  core/
    config.ts                 read/validate settings, change subscription
    tracking/
      documentTracker.ts      snapshots, debounce, edit diffs
      fileTracker.ts          create/delete/rename + external watcher
      saveTracker.ts
      taskTracker.ts
      debugTracker.ts
      terminalTracker.ts
      trackingController.ts   start/stop, enabled/paused gates
    diff/
      weightedDp.ts           small-input length-weighted DP (N+M < 1700)
      myers.ts                O(ND) line diff for larger inputs
      hunks.ts                context/hunks/unified output
      wordDiff.ts             intra-line marks (own token diff, no dependency)
      diffEngine.ts           public API + limits + truncation
    store/
      activityStore.ts        ring buffer, stats, updates, pages
      persistence.ts          atomic JSON file, schema validation
      stats.ts
    export/
      exporters.ts            JSON + Markdown
    pathUtils.ts              workspace-relative paths, excludes
    logger.ts                 OutputChannel wrapper
  ui/
    webviewHost.ts            panel + sidebar + serializer, message routing
    webviewHtml.ts            CSP, nonce, asset URIs
    statusBar.ts
    commands.ts
    messages.ts               runtime guards for webview input
    i18n.ts                   host strings (en/fa) + locale/direction resolution
webview/
  src/
    main.tsx                  surface bootstrap + mock API in preview mode
    app/                      store, hooks, protocol client
    surfaces/                 Panel.tsx, Sidebar.tsx, About.tsx
    components/               Hero, OrbitMark, StatCard, Timeline, EventCard, DiffBlock, ...
    styles/                   tokens.css, global.css, components
    i18n/                     en.ts, fa.ts
  preview/                    standalone mock harness for browser visual QA
test/
  unit/                       Vitest (diff, store, exporters, filters, protocol)
  webview/                    Vitest + Testing Library
  integration/                @vscode/test-electron + Mocha
scripts/
  build.mjs                   esbuild + vite orchestration (dev/watch/prod)
  make-icon.mjs               SVG -> PNG 256/128 (sharp or resvg)
media/                        activity-bar + panel icons
images/                       marketplace icon and README screenshots
```

## 4. Shared model (contract)

```ts
// src/shared/model.ts
export type Surface = "panel" | "sidebar" | "about";
export type EventKind =
  | "edit" | "save" | "file-create" | "file-delete" | "file-rename" | "file-change"
  | "task" | "debug" | "terminal";
export type EventStatus = "running" | "done" | "failed";
export type TimeRange = "session" | "5m" | "1h";

export interface DiffStat {
  added: number;
  removed: number;
  hunks: number;
  truncated: boolean;
}

export interface DiffLine {
  kind: "context" | "added" | "removed";
  text: string;
  oldLine?: number;
  newLine?: number;
  /** Word-level segments; only on added/removed lines. */
  words?: Array<{ text: string; changed: boolean }>;
}

export interface DiffHunk {
  header: string;        // @@ -a,b +c,d @@
  lines: DiffLine[];
}

export interface DiffPayload {
  eventId: string;
  hunks: DiffHunk[];
  stat: DiffStat;
  fullAvailable: boolean;
  unified?: string;      // capped; used by Copy diff
}

interface EventBase {
  id: string;
  seq: number;           // monotonically increasing, persisted
  sessionId: string;
  ts: number;
  status: EventStatus;
}
export interface EditEvent extends EventBase {
  kind: "edit";
  relPath: string;
  languageId?: string;
  diff: DiffStat;
  reason?: "undo" | "redo";   // from TextDocumentChangeEvent.reason; absent = user/unknown
  eol?: "\n" | "\r\n";
  searchText?: string;        // first ~400 chars of added/removed text
}
export interface FileEvent extends EventBase {
  kind: "save" | "file-create" | "file-delete" | "file-change";
  relPath: string;
  source?: "editor" | "watcher";  // provenance; never rendered raw
}
export interface RenameEvent extends EventBase {
  kind: "file-rename";
  relPath: string;       // new path
  fromPath: string;
}
export interface TaskEvent extends EventBase {
  kind: "task";
  taskName: string;
  taskSource: string;
  exitCode?: number;
  durationMs?: number;
}
export interface DebugEvent extends EventBase {
  kind: "debug";
  debugName: string;
  debugType: string;
  durationMs?: number;
}
export interface TerminalEvent extends EventBase {
  kind: "terminal";
  command: string;
  cwd?: string;          // workspace-relative when possible
  exitCode?: number;
  durationMs?: number;
}
export type ActivityEvent =
  | EditEvent | FileEvent | RenameEvent | TaskEvent | DebugEvent | TerminalEvent;

export interface SessionStats {
  events: number;
  files: number;
  added: number;
  removed: number;
  sessionStartedAt: number;
  durationMs: number;
}

export interface Filters {
  kinds: EventKind[];
  query: string;
  timeRange: TimeRange;
}
```

Settings, defaults, and limits live in `src/shared/constants.ts`; the extension config layer
validates ranges. No `vscode` import may appear under `src/shared`.

## 5. Event pipeline

### 5.1 Text edits (DocumentTracker)
- Snapshot on open (workspace `file` scheme only, inside a workspace folder, <= `maxFileSizeKB`);
  release on close. Snapshot = lines plus `document.eol`; diff on lines without EOL characters.
- On change: reset a per-document debounce timer (`debounceMs`, default 300; hard flush at 1.5 s
  of continuous changes). On flush: `old = snapshot.text`, `next = document.getText()`.
  **SUPERVISOR**: re-read the document at flush instead of replaying `contentChanges` into the
  cached line array; the re-read is bounded by `maxFileSizeKB` and removes a whole class of
  offset bugs. Use `document.version` only to detect no-ops (unchanged version) and never for
  incremental mutation.
- Never diff in the change handler. The handler only marks the document dirty and (re)arms timers.
- If `event.contentChanges.length === 0`, ignore for diff purposes.
- If `event.reason` differs from the open burst's reason (e.g. user typing followed by undo),
  flush the current burst first and start a new one; tag the new event `reason: "undo" | "redo"`.
- Skip when `old === next`, when disabled/paused, when excluded by glob, or when too large.
- Compute the diff once; create one `edit` event per burst; update snapshot to `next`.
- Flush the pending edit before a save event so ordering is correct.
- Also flush a dirty document when it stops being visible (`onDidChangeVisibleTextEditors`) or is
  closed, because `onDidCloseTextDocument` has no tab-close guarantee; guard with `document.isClosed`.
- Multi-cursor edits are one burst. Outside-workspace files are ignored by default; setting opt-in
  uses basename only. Untitled docs are tracked as edits but never produce file events/stats.

### 5.2 File operations
- API events (`onDidCreateFiles`, `onDidDeleteFiles`, `onDidRenameFiles`, stable since 1.50) plus a
  `workspace.createFileSystemWatcher("**/*")` for external operations and changes to closed files.
  These API events do **not** fire for on-disk writes or `workspace.fs`; the watcher covers those.
- Deduplicate API/watcher pairs by `(kind, canonical URI)` for 1 s. `onDidRenameFiles` is the only
  authoritative rename signal; a watcher delete+create pair stays two truthful events (watcher
  events carry no size or rename link). Watcher events are debounced 500 ms/path.
- `file-change` is emitted only when no open document tracks that path (avoids double cards);
  when an open document is dirty, emit `file-change` (external on-disk write) and do not diff.
- Use one watcher for life, created only when file tracking is enabled; filter through
  `excludeGlobs` (defaults include `**/node_modules/**`, `**/.git/**`, `**/dist/**`, `**/out/**`,
  `**/.next/**`, plus the workspace `files.watcherExclude` patterns).
- Key tracked documents by `uri.toString()`; lowercase `fsPath` only for Windows comparisons,
  never for display.

### 5.3 Save, tasks, debug
- Save: one `save` event; flush pending edit first. `onDidSaveTextDocument` is the only reliable
  save signal (`onWillSave` has a 1.5 s budget and may be skipped); coalesce save storms per
  document within 250 ms.
- Tasks: `onDidStartTask` creates a `running` event; `onDidEndTaskProcess` (matched by task id /
  process id) updates it with `exitCode`/`durationMs`/`failed`. Update is sent to webviews as
  `event-update`. Tasks without an underlying process may never emit process events; close on
  `onDidEndTask`.
- Debug: start creates event; terminate updates it to done with duration. A restart produces a
  new session id, so it is shown as two truthful cards; no fabricated coalescing.

### 5.4 Terminal (stable in 1.93, still defensive)
- Listen to `onDidChangeTerminalShellIntegration`, `onDidStartTerminalShellExecution`, and
  `onDidEndTerminalShellExecution` from activation; the change event must be observed before
  commands run. Also guard with a runtime `typeof` check so the extension degrades cleanly.
- Map execution objects with a `WeakMap` to event ids. Start creates a `running` card; commit the
  command text and `exitCode` at end (`exitCode === undefined` is not failure). Never assume
  `cwd` exists.
- Command text is stored locally; README and setting warn that commands may contain secrets.
  `activityreel.trackTerminal` disables the whole tracker.
- Without shell integration, no terminal events (never fake them).

### 5.5 Ordering and coalescing
- All events receive `seq` from one monotonic counter and are appended to the store.
- WebviewHost batches outbound events every 100 ms (one message per batch) and sends stats with
  the batch; UI never re-renders per event during a burst. Queue messages until the webview sends
  `ready`, then send one `init`; `postMessage` returning false means the webview is gone, not an
  error to retry.
- Store mutations happen on the extension host only; each surface holds its own UI state.

## 6. Diff engine contract

```ts
// src/core/diff/diffEngine.ts
export interface DiffResult {
  lines: DiffLine[];        // full operation list, capped
  stat: DiffStat;
  unified: string;          // capped unified diff
  fullAvailable: boolean;
}
export function diffText(oldText: string, newText: string, options: DiffOptions): DiffResult;
export function toHunks(lines: DiffLine[], contextLines: number): DiffHunk[];
export function attachWordDiff(hunks: DiffHunk[]): DiffHunk[];
```

- Split lines without terminators (`/\r\n|\r|\n/`, no phantom final line); remember `eol` separately.
  If normalized lines are identical but the text differs (EOL/trailing-newline-only change), emit
  one honest 1:1 replace hunk instead of dropping the edit.
- Trim common prefix/suffix lines, then:
  - if `(N + M) < 1700` **and** `N * M <= 180_000`: length-weighted DP (match score
    `1 + Math.log1p(lineLength)`, gaps preferred over mismatches), mirroring VS Code's small-input
    heuristic; this produces more human hunks on short edits;
  - else Myers O(ND) with an edit-distance cap of `D <= 600` and a hard cell/time guard;
  - if a guard trips (D > 600, > 20k middle lines, > 250 ms), emit a coarse block-replace hunk
    (trimmed prefix/suffix kept) and set `truncated`.
- **SUPERVISOR**: no move detection in v1. It adds mis-attribution risk and cost; a moved block is
  shown as remove+add, which is truthful.
- Produce full operation lines with old/new line numbers; keep up to `maxDiffLines` (default 500)
  operation lines for display. `fullAvailable` is false when capped; the UI offers "copy full
  diff" only when the unified payload is complete, otherwise "diff truncated".
- Hunking: context default 3; changes separated by <= 2*context merge. Hunk header uses
  `@@ -oldStart,oldLines +newStart,newLines @@`.
- Word diff: own Unicode-aware token diff (no external dependency). Pair removed/added lines
  sequentially within each change block; run a token LCS (cap 400 tokens/line) and emit `words`
  segments. Skip for lines > 3000 chars, > 200 pairs per burst, or minified heuristics (avg line
  > 500 chars). Never changes text color, only background/underline.
- Unified diff output for clipboard/export; cap at 2 MB. Escape Markdown fences by switching to
  `~~~` when content contains a backtick fence.
- Pure functions, no `vscode` imports; injected `now()` and deterministic limits for tests.
  Fully unit-tested: CRLF/LF, Persian/emoji/surrogate pairs, insert/delete/replace, multi-hunk,
  identical input, EOL-only change, coarse fallback, apply-diff-is-identity property test.

## 7. Store & persistence

- `ActivityStore` is a bounded ring buffer (`maxEvents`, default **1000**, range 100–5000) keyed
  by id, with `seq` ordering. Diff payloads live in a separate `Map<id, DiffPayload>` retaining the
  newest **300** diffs; older events keep stats and render a "diff expired" state. Evolving diff
  payloads are evicted with their events. **SUPERVISOR**: this reconciles the UI target of 1000+
  events with a bounded memory/persistence footprint.
- Stats are computed incrementally; `durationMs` is derived at read time from `sessionStartedAt`.
- Persistence: versioned JSON at `context.storageUri` (`activityreel-activity.v1.json`), written
  atomically (temp + `workspace.fs.rename(overwrite: true)`) and debounced 2 s, only when dirty;
  also on deactivate best-effort. A failed write logs once and never blocks tracking.
- Schema validation on load: a newer `v` is opened read-only and the file renamed aside before any
  write; malformed events dropped; caps re-applied; `seq` restored. Corrupt storage never blocks
  activation. If >20 % of the file is unparseable, start a fresh session and archive the old file.
- Persist metadata plus retained hunks; if the serialized size exceeds **8 MB**, drop diffs from
  the oldest events until it fits, then drop oldest events. Absolute paths are never persisted
  (workspace-relative paths with the folder name in multi-root workspaces). Timestamps are UTC ISO.
- `clear` wipes memory, storage file, stats, and broadcasts `cleared`; a native modal confirms.

## 8. Webview protocol

```ts
// src/shared/protocol.ts (excerpt)
export type HostMessage =
  | { type: "init"; surface: Surface; version: string; locale: string;
      direction: "ltr" | "rtl"; settings: Settings; events: ActivityEvent[];
      stats: SessionStats; paused: boolean; filters: Filters; hasMore: boolean }
  | { type: "events"; events: ActivityEvent[]; stats: SessionStats }
  | { type: "event-update"; event: ActivityEvent; stats: SessionStats }
  | { type: "diff"; payload: DiffPayload }
  | { type: "older"; events: ActivityEvent[]; hasMore: boolean }
  | { type: "state"; paused: boolean; settings: Settings }
  | { type: "stats"; stats: SessionStats }
  | { type: "cleared" }
  | { type: "toast"; level: "info" | "warn" | "error"; message: string };

export type WebviewMessage =
  | { type: "ready" }
  | { type: "open"; id: string }                    // host resolves URI from its store
  | { type: "requestDiff"; id: string; full?: boolean }
  | { type: "copy"; text: string }                  // capped at 2 MB
  | { type: "copyDiff"; id: string }
  | { type: "requestOlder"; beforeSeq: number }
  | { type: "setFilters"; filters: Filters }
  | { type: "pause"; value: boolean }
  | { type: "clear" }
  | { type: "export"; format: "json" | "markdown" }
  | { type: "openAbout" }
  | { type: "openPanel" };                      // sidebar header → full panel
```

Rules:
- Initial payload contains metadata only; diffs are fetched on card expansion (`requestDiff`).
- `open` carries only an event id; the host never accepts a URI/path from the webview.
- Host validates every message shape, caps text, ignores unknown types, and never logs content.
- `filters` are persisted workspace-scoped and echoed in `init` so both surfaces agree.
- `ready` triggers `init`; panel state (expanded ids, scroll) is kept with `vscode.setState`.

## 9. Surfaces, commands, configuration

- Sidebar: `viewsContainers.activitybar` (`activityreel`) + `views` (`activityreel.feed`, type webview).
- Panel: created by `activityreel.open`, restored by `WebviewPanelSerializer` (`activityreel.panel`).
- About: `activityreel.about` opens a panel with `surface=about`.
- Commands: `activityreel.open`, `activityreel.togglePause`, `activityreel.clear`,
  `activityreel.exportJson`, `activityreel.exportMarkdown`, `activityreel.about`.
- Keybinding: `ctrl+alt+l` / `cmd+alt+l` for `activityreel.open` (user-overridable).
- Status bar: `$(pulse) ActivityReel` / `$(debug-pause)`; tooltip shows session stats; opens panel.
- Manifest: `engines.vscode ^1.93.0`, `activationEvents: ["onStartupFinished",
  "onWebviewPanel:activityreel.panel"]`, `capabilities.untrustedWorkspaces`
  supported (observer only; strict CSP; no code execution) and `capabilities.virtualWorkspaces`.
- Settings (all workspace-scoped unless noted): `enabled` (true), `maxEvents` (1000),
  `maxDiffLines` (500), `contextLines` (3), `debounceMs` (300), `persistHistory` (true),
  `trackFileOperations` (true), `trackTasks` (true), `trackDebug` (true), `trackTerminal` (true),
  `trackExternalChanges` (true), `excludeGlobs`, `maxFileSizeKB` (2048), `statusBar` (true),
  `locale` ("auto" | "en" | "fa"), `openFilesOutsideWorkspace` (false).
- `activityreel.enabled=false` stops tracking; history stays readable. Pause is a runtime state on
  top of the setting and is not persisted.
- Locale: extension-host strings via `src/ui/i18n.ts` (a custom table, because `activityreel.locale`
  must win over the VS Code UI language); webview has its
  own `en`/`fa` bundles. Direction comes from the resolved locale (`fa` → `rtl`), not from VS
  Code's UI language alone.

## 10. Security

- Webview CSP (meta tag, per load, nonce for the inline bootstrap only):
  `default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline';`
  `font-src ${cspSource}; script-src 'nonce-${nonce}' ${cspSource}; connect-src 'none';`
  `object-src 'none'; media-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`.
  `'unsafe-inline'` is limited to styles (React inline style props for stagger/animation); no
  user-controlled CSS. `frame-ancestors` is omitted because it is ignored in meta-delivered CSP.
- `localResourceRoots: [extensionUri/media]` only; assets are referenced via `asWebviewUri`; the
  bundle is one IIFE with fixed asset names (`media/webview/main.js`, `main.css`).
- `enableCommandUris` stays off; no remote assets, fonts, images, or network calls anywhere;
  no telemetry or error reporting. All UI text is rendered as React text nodes.
- All document text is rendered as text nodes; no `dangerouslySetInnerHTML`. Clipboard goes through
  the extension host (`vscode.env.clipboard.writeText`) with a 2 MB cap.
- Workspace boundary enforced for tracking, opening, and export; symlinks resolved via VS Code URIs.
- Terminal command text is sensitive: local only, disableable, and called out in the README.
- Export uses the native save dialog; filenames are fixed (`activityreel-export-<date>.<ext>`).

## 11. Performance budgets

- Activation: < 10 ms of synchronous work; no webview, timers, or fs reads until needed.
- Ingestion: no diff work until the debounce flush; one diff per document per burst.
- Diff caps: `maxDiffLines` 500 display; DP ≤180k cells, Myers D ≤600, hard 250 ms; coarse
  fallback beyond. Target P95 flush < 30 ms for ≤2000 lines.
- IPC: batched every 100 ms; diffs on demand; payload caps (searchText 400 chars, unified 2 MB).
- UI: virtualized feed with <= 40 mounted cards at 1,000 events; React.memo per card; counters
  isolated; CSS transform/opacity animations only; initial render < 300 ms.
- Persistence: debounced 2 s; serialized file ≤8 MB; newest 300 diffs retained.

## 12. Build, test, package

- `npm run build`: esbuild extension (CJS, node) + Vite webview IIFE + copy static assets.
- `npm run watch`: both in watch mode; F5 preLaunch runs `build`.
- `npm run typecheck`: extension and webview tsc projects, `--noEmit`.
- `npm run lint`: ESLint flat config, zero warnings.
- `npm run test`: Vitest unit + webview tests.
- `npm run test:integration`: build + `vscode-test` against the installed VS Code if supported,
  else the pinned download.
- `npm run package`: check + `vsce package` -> `activityreel-<version>.vsix`.
- VSIX contains `dist/**`, `media/**`, `images/**`, `package.json`, `README.md`, `CHANGELOG.md`,
  `LICENSE`, `THIRD_PARTY_NOTICES.md`; excludes `src/`, `webview/`, `test/`, `docs/`,
  `node_modules/` and configs.
- Integration tests expose a test-only command (`activityreel.__test.snapshot`) gated by
  `ExtensionMode.Test` to inspect events without driving the webview.

## 13. Resolved decisions and remaining runtime checks

Resolved from `docs/research/algorithms-and-apis.md` (2026-11-21):

1. `engines.vscode = ^1.93.0` covers file-operation events (1.50), file decorations (1.52), undo
   reason (1.58), file decorations (1.52), and terminal shell integration (1.93) with no gates.
2. `contentChanges` ranges refer to the pre-change document; `version` increases on undo/redo.
   We therefore re-read at flush and use `version` only for no-op detection.
3. Diff thresholds are fixed in §6; small-input DP is length-weighted; no move detection in v1.
4. `onWebviewPanel:activityreel.panel` is required to restore a serialized panel after reload.
5. `storageUri` + `workspace.fs` is the only persistence route; atomic rename is best-effort
   (`overwrite: true`) and a failed rename falls back to a direct write.

Remaining runtime checks (cover with integration tests, not assumptions):

- `TextDocumentChangeEvent.reason` completeness across 1.93–1.147 and multi-cursor undo grouping.
- Watcher vs API events for on-disk writes on Windows (case-insensitive paths, UNC).
- `onDidCloseTextDocument` behavior with dirty tabs; confirm the visibility-loss flush covers it.
- Terminal shell integration availability matrix (cmd/PowerShell/Windows Terminal) and late attach.
- `@tanstack/react-virtual` dynamic measurement with expandable diff cards.
- Vite IIFE + extracted CSS under our CSP on panel and sidebar surfaces.
- RTL rendering (`dir="rtl"`) with VS Code scrollbars and the Persian bundle.

## 14. Explicitly deferred (do not implement in v1)

- Move detection / move labels; anchored cross-burst hunk identity; review sessions with
  keep/reject or checkpoints; editor-injected hunk controls.
- Historical side-by-side diff via `TextDocumentContentProvider` + `vscode.diff`.
- Explorer file decorations (`FileDecorationProvider`) for touched files.
- `retainContextWhenHidden`; worker threads; any remote asset or CDN.
