# ActivityReel — Diff Engine and VS Code Integration: Verified Design Reference

Status: research / design input to `docs/PROJECT.md` §7. Author: algorithms & API research pass.
Research date: **2026-11-21** (all URLs accessed that day unless stated).
This file modifies no source; it is the only artifact of this task.

### Evidence labels used below

| Label | Meaning |
| --- | --- |
| **[DOC]** | Stated in official VS Code docs / release notes / API reference (URL cited). |
| **[TYPES]** | Confirmed by inspecting typings: installed VS Code **1.147.0** `resources/app/out/vscode-dts/vscode.d.ts`, or published `@types/vscode` tarballs, version bisected (see §2.1). |
| **[SRC]** | Confirmed in VS Code / Git / Google library source code (URL cited). |
| **[INF]** | Engineering inference or recommendation from this research; **not** an upstream guarantee. Requires our own benchmark/runtime validation (§9). |
| **[TO-VERIFY]** | Must be validated at runtime or in a new official doc; do not treat as fact. |

---

## 1. Decision table

| # | Requirement (PROJECT.md) | Chosen approach | Why | Rejected alternatives |
| --- | --- | --- | --- | --- |
| D1 | Detect every text edit burst (§F1) | `workspace.onDidChangeTextDocument` | Only API that sees unsaved edits; `version` is monotonic [TYPES]. | Polling `doc.getText()` — misses intermediate states, wasteful [INF]. |
| D2 | Per-document burst collapsing | Debounce/coalesce keyed on `(scheme, authority, fsPath)` + `document.version`; flush after 400 ms idle or 1.5 s max | Typing emits 1 event/keystroke; burst merge matches "one collapsed card" [INF]. | Per-event cards (spam); fixed 1 s timer only (drops agent bursts). |
| D3 | Snapshot before/after | Keep **line array** before burst (cached from last flush) and read lines after debounce; apply `contentChanges` incrementally to the cached lines as a cheap alternative (`rangeOffset/rangeLength/text`) | Snapshot without extra allocations; `contentChanges` ranges are for the pre-change doc [TYPES] so they are replayable in order. | Storing full `getText()` per keystroke (memory). |
| D4 | Line diff | **Myers O(ND)** with common prefix/suffix trim + equidistant-line compaction; fallback below | Matches PROJECT.md §7; Myers is the same family VS Code itself uses [SRC]. | Patience/Histogram as primary (slower on repetitive code) — kept as opt-in. |
| D5 | Accuracy on short sessions | For small inputs reuse VS Code's own heuristic: use DP with a "line length bonus" when `N+M < 1700`, Myers otherwise [SRC] | Empirically tuned by VS Code; cheap to replicate. | One algorithm for all sizes. |
| D6 | 1:1 similarity metric ("+N/−N" accuracy) | Score candidate alignments by similarity (à la VS Code DP scoring) and prefer the highest-scoring one | Reduces "everything changed" output on reformats [SRC]. | Plain LCS length only. |
| D7 | Moved-block readability | Post-pass **move detection** on change blocks (hash of block, ignore if > 40 % of file moved) | VS Code ships a move detector [SRC]; Git histogram's win is the same idea [SRC]. | Patience for everything (loses on small/noisy hunks). |
| D8 | Word-level highlight inside paired lines | `diff-match-patch` word-mode (`diff_cleanupSemantic`), with `Diff_Timeout` and char budget | Maintained, battle-tested, semantic cleanup merges junk [SRC]. | VS Code's `charLevelDiffing` (private, inaccessible). |
| D9 | Large docs / minified | Hard guards: `lines > 20 000` or `bytes > 2 MB` → no word-level diff; `lines > 50 000` or `bytes > 10 MB` → header-only card ("diff too large") | Keeps extension host responsive; mirrors VS Code's 5 s / 50 MB diff-editor ceilings [SRC]. | Try/catch around diff (leave timeouts in place anyway). |
| D10 | Never block extension host | Diff runs synchronously only under a **cell budget** (`cells = trimA*trimB ≤ 180 000` and `D*N` proxy ≤ 6e6), else chunked/time-sliced with hard 250 ms budget and truncated flag | Extension host is single-threaded per extension [DOC extension-host]. | `worker_threads` (allowed in desktop Node but not web extension host; also complicates packaging). |
| D11 | File create/delete/rename | `workspace.onDidCreateFiles/onDidDeleteFiles/onDidRenameFiles` for in-editor gestures; `createFileSystemWatcher('**/*')` for on-disk/external | Explicitly different coverage: file-operation events are **not** fired for disk changes or `workspace.fs` [TYPES]. | Watcher only (misses Explorer-undo semantics, gives no rename link). |
| D12 | Saves | `onDidSaveTextDocument` (and `onWillSaveTextDocument` only to snapshot pre-save state) | WillSave can be delayed/aborted; must not rely on it for ordering [TYPES]. | `onWillSave` as the save signal. |
| D13 | Undo/redo labelling | Read `event.reason` (`TextDocumentChangeReason.Undo/Redo`, `undefined` if unknown) since **1.58** [TYPES]; still diff normally | Undo is a legitimate change; never filter it out, only tag it [INF]. | Ignoring undo events (breaks "+/−" accuracy). |
| D14 | Tasks / debug | `tasks.onDidStartTask`, `onDidEndTask`, `onDidEndTaskProcess`, `debug.onDidStartDebugSession`, `onDidTerminateDebugSession` | Old, stable API, no gating needed [TYPES: present in 1.50]. | Terminal scraping. |
| D15 | Terminal commands | `window.onDidChangeTerminalShellIntegration`, `onDidStartTerminalShellExecution`, `onDidEndTerminalShellExecution`; **feature-detect** (`typeof window.onDid… === 'function'`) | Became **stable in 1.93** [DOC]; absent in 1.92 typings [TYPES]. | `shellIntegration` proposal (unpublishable). |
| D16 | Webview UI | `createWebviewPanel` + view contribution sharing one bundle; strict CSP with nonce + `cspSource`; `localResourceRoots=[media dir]`; `getState/setState`; **no** `retainContextWhenHidden` | Official security recipe [DOC]; `retainContextWhenHidden` has "high memory overhead" [DOC]. | `retainContextWhenHidden: true` (memory), remote CDN assets (violates F6). |
| D17 | Open a historical file version / side-by-side | `vscode.diff` with our `TextDocumentContentProvider` scheme `activityreel-diff:` (content keyed by `?id=<eventId>`), plus `vscode.open` for plain navigation | Built-ins, no package needed [DOC commands]. | Custom editor (overkill for v1). |
| D18 | Explorer badge for touched files | `window.registerFileDecorationProvider` | Available since 1.52 [DOC/TYPES]; decoration strings are **path-keyed only** — store a map, not per-URI objects. | Tree view duplication. |
| D19 | Export | `window.showSaveDialog` → `workspace.fs.writeFile` | Works over remote; returns `file:`/`vscode-remote:` URIs correctly [DOC remote]. | `fs.writeFile` from Node (breaks virtual/remote workspaces). |
| D20 | Localization (en + fa) | `vscode.l10n.t()` + `l10n/` bundle dir declared in `package.json` `"l10n": "./l10n"` [DOC]; locale detection for RTL via `l10n.t` output / `env.language` | Stable since **1.73** [DOC]; bundles format is flat `key → value` with `{0}` placeholders [DOC l10n-dev]. | `vscode-nls` (legacy). |
| D21 | Persistence | `context.storageUri` JSONL append-only log + `workspaceState` for small metadata (schemaVersion, filters, sessionId) | `storageUri` "safe" URI for workspace data [DOC]; caps memory, survives >Memento limits [INF]. | `workspaceState` for whole history (size/transaction risk). |
| D22 | Entry point policy | `engines.vscode: "^1.93.0"` (+ `@types/vscode@1.93.x` dev dep); `activationEvents: ["onStartupFinished", "onWebviewPanel:activityreel.panel"]` | 1.93 = first stable with terminal API; keeps optional terminal card *stable*, not gated. | `^1.90.0` (current package.json) → must gate terminal API. |

---

## 2. Verified API matrix

### 2.1 Method of verification

**[INF/method]** Typings are the ground truth for *when an API became available in stable typings*. Modern `vscode.d.ts` no longer carries machine-readable `@since` tags, so each API was **bisected across published `@types/vscode` versions** (`https://unpkg.com/@types/vscode@<v>/index.d.ts`, accessed 2026-11-21) and cross-checked in release notes. Results:

| API symbol | Present from | Absent at | Decisive check |
| --- | --- | --- | --- |
| `onDidCreateFiles`, `onDidDeleteFiles`, `onDidRenameFiles`, `onWill*Files` | **1.50.0** | 1.49.0 | `grep 'export const onDidCreateFiles'` |
| `registerFileDecorationProvider` | **1.52.0** | 1.51.0 | also [DOC v1_52] "FileDecorationProvider API is now final" |
| `TextDocumentChangeReason`, `TextDocumentChangeEvent.reason` | **1.58.0** | 1.57.0 | `grep TextDocumentChangeReason` |
| `l10n` namespace (`vscode.l10n.t`) | **1.73.0** (typings 1.74.0) | 1.72.0 | [DOC v1_73] "finalization of the localization API… proposed last month"; [DOC v1_74] "Last month we stabilized the new Localization (l10n) API" |
| `onDidChangeTerminalShellIntegration`, `onDidStart/EndTerminalShellExecution` | **1.93.0** | 1.92.0 | [DOC v1_93] "The terminal shell integration API is now available to use" |

### 2.2 Matrix

| API | Stable since | Verified semantics / notes | Source |
| --- | --- | --- | --- |
| `workspace.onDidChangeTextDocument(e)` | 1.0-era (baseline) | `e.contentChanges: TextDocumentContentChangeEvent[]`; `range`, `rangeOffset`, `rangeLength`, `text`. Ranges are **relative to the document as it was before that change event**; multiple changes in one event are applied in array order [TYPES]. | [TYPES] vscode.d.ts:13422-13460; [API] `#workspace.onDidChangeTextDocument` |
| `TextDocumentChangeEvent.reason` | **1.58.0** | `TextDocumentChangeReason.Undo = 1`, `Redo = 2`, or `undefined` ("reason not known") [TYPES]. | [TYPES]; bisect §2.1 |
| `TextDocument.version` | 1.0-era | "strictly increase after each change, **including undo/redo**" [TYPES] — usable as an idempotency/gap detector. | [TYPES] vscode.d.ts:141 |
| `workspace.onWillSaveTextDocument` | 1.0-era | Listeners may `waitUntil`; shared **1.5 s** budget, misbehaving listener ignored after **3** failures; editor may save **without firing** (shutdown with dirty files) [TYPES]. | [TYPES] vscode.d.ts:14525-14541 |
| `workspace.onDidSaveTextDocument` | 1.0-era | Fires after write; the only reliable "saved" signal. | [TYPES] |
| `workspace.onDidOpenTextDocument` / `onDidCloseTextDocument` | 1.0-era | Open also fires on `languages.setTextDocumentLanguage`; **not** emitted if doc already open elsewhere; close has **no** guarantee of firing on tab close (use `window.onDidChangeVisibleTextEditors`) [TYPES]. | [TYPES] vscode.d.ts:14498-14519 |
| `onDidCreate/Delete/RenameFiles` (+`onWill*`) | **1.50.0** | Fired by user gestures / `workspace.applyEdit`; **not** fired for on-disk changes, other apps, or `workspace.fs`; folder ops emit **one** event [TYPES]. Undo of Explorer file ops does **not** re-fire will-events [DOC v1_52]. | [TYPES]; [DOC v1_52] |
| `workspace.createFileSystemWatcher(glob, ignoreCreate, ignoreChange, ignoreDelete)` | 1.0-era | Covers external/on-disk changes; path casing and symlinks "preserved as provided for watching"; supports `RelativePattern` outside workspace (non-recursive unless `**`) [TYPES]. | [TYPES] vscode.d.ts:14240-14300 |
| `tasks.onDidStartTask` / `onDidEndTask` / `onDidStartTaskProcess` / `onDidEndTaskProcess` | baseline (≤1.50) | Process events "will not fire for tasks that don't execute an underlying process" [TYPES]. Use start/end for cards; process events for exit codes. | [TYPES] vscode.d.ts:9392-9411 |
| `debug.onDidStartDebugSession` / `onDidTerminateDebugSession` | baseline (≤1.50) | Straightforward; terminate also fires for restarts (session churn — coalesce by `session.id`) [INF]. | [TYPES] vscode.d.ts:17585-17595 |
| `window.onDidChangeTerminalShellIntegration` | **1.93.0** | Fires when shell integration activates or changes; **must** be listened to before commands run. | [DOC v1_93]; [TYPES] 1.93 |
| `window.onDidStartTerminalShellExecution` | **1.93.0** | Fires only with shell integration active; `execution.commandLine` confidence may improve after end event; `cwd` may be `undefined`; `read()` stream only has data after first call [TYPES]. | [DOC v1_93]; [TYPES] vscode.d.ts:7921-7995 |
| `window.onDidEndTerminalShellExecution` | **1.93.0** | Provides `execution`, `exitCode` (`undefined` has multiple meanings — do not assume failure) [TYPES]. | [TYPES] |
| `window.createWebviewPanel(type,title,column,options)` | 1.0-era | `options: WebviewPanelOptions & WebviewOptions` (`enableScripts`, `localResourceRoots`, `retainContextWhenHidden`, `enableCommandUris`, `portMapping`) [TYPES]. | [TYPES] vscode.d.ts:11547 |
| `Webview.cspSource` / `asWebviewUri(uri)` / `postMessage` | 1.0-era | `cspSource` = origin to put into CSP; `asWebviewUri` only for resources inside `localResourceRoots`; `postMessage` resolves `false` when webview not live [TYPES]. | [TYPES] vscode.d.ts:9960-10055; [DOC webview] |
| `acquireVsCodeApi().getState()/setState()` | 1.0-era | State survives hidden→visible; destroyed with panel; "preferred way… much lower overhead than `retainContextWhenHidden`" [DOC]; only **one** `acquireVsCodeApi()` call per session [DOC]. | [DOC webview] §Persistence |
| `retainContextWhenHidden` | 1.0-era | "high memory overhead", use only if other persistence fails [DOC]; with it, `postMessage` reaches hidden webview [TYPES]. | [DOC webview] |
| `window.registerTextDocumentContentProvider(scheme, provider)` | 1.0-era | One provider per scheme; `onDidChange` invalidates; document is closed when scheme doc closed [TYPES]. Basis for `vscode.diff` on history snapshots. | [TYPES] vscode.d.ts:1845-1870 |
| `window.registerFileDecorationProvider` | **1.52.0** | `provideFileDecoration` called only when a file is rendered; `badge` is "a very short string"; `propagate` for folder rollup; `onDidChangeFileDecorations` accepts `undefined` (all) / `Uri` / `Uri[]` [TYPES]. | [TYPES]; [DOC v1_52] |
| `commands.executeCommand('vscode.diff', left, right, title, options?)` | 1.0-era | Built-in: opens diff editor [DOC commands]. | [DOC commands] `#vscode.diff` |
| `commands.executeCommand('vscode.open', uri, columnOrOptions?, label?)` | 1.0-era | Built-in [DOC commands]. | [DOC commands] |
| `window.showSaveDialog(options)` → `Uri \| undefined` | 1.0-era | Returns a client URI; write via `workspace.fs`. | [TYPES] vscode.d.ts:11478 |
| `workspace.fs` (`readFile/writeFile/stat/createDirectory`, `Uri.joinPath`) | 1.0-era (final 1.37) | Routes by URI + filesystem provider; works remote (URI may be `vscode-remote:`); **do not** convert to paths [DOC remote]. | [DOC remote] table |
| `context.storageUri` / `globalStorageUri` | 1.0-era | "safe" per-workspace / global file URIs; `globalStorageUri` etc. recommended for complex data [DOC remote]. | [TYPES]; [DOC remote] |
| `context.workspaceState` / `globalState` (Memento) | 1.0-era | `get<T>(key, default)`, `update(key, value)` returns Thenable; `setKeysForSync` only on `globalState` [TYPES]. **No documented size cap** in API reference [TO-VERIFY]. | [TYPES] vscode.d.ts:8437-8540; [DOC remote] |
| `vscode.l10n.t(msg, ...args)` | **1.73.0** | Requires `l10n` field in `package.json`; `{0}`/`{name}` placeholders; bundles at `l10n/bundle.l10n.<locale>.json` flat `{"source":"translated"}` [DOC]. | [TYPES]; [DOC l10n-dev]; [DOC v1_73] |
| Theming in webview | 1.0-era | Body classes `vscode-light`, `vscode-dark`, `vscode-high-contrast`; theme colors as `--vscode-*` CSS vars; `--vscode-editor-font-*`; `body[data-vscode-theme-id]`; accessibility classes `vscode-reduce-motion`, `vscode-using-screen-reader` [DOC]. | [DOC webview] §Theming/§Accessibility |
| RTL in webview | n/a | Docs contain **no** dedicated RTL API; use plain HTML `dir="rtl"`/`dir="auto"` and logical CSS (`margin-inline-start`, `inset-inline-*`) [DOC: none] | [TO-VERIFY] — see §9 |

**Recommended `engines.vscode`: `"^1.93.0"`** (keep `@types/vscode` at the same minor, currently `^1.93.0`, and pin `npm` engines check in CI). Rationale: covers every API above with **zero** feature gates; 1.93 shipped 2024-10 and is >2 years old at publish time [DOC v1_93]. If marketing requires older support, `^1.90.0` is *feasible* but forces runtime feature detection for the three terminal APIs and three `onDid*` events [INF].

---

## 3. Recommended pipeline

```
ingest (sync, <5 ms)            coalesce            snapshot            diff                 hunks              webview
────────────────────────        ──────────          ────────            ────                 ─────             ───────
onDidChangeTextDocument  ──► per-doc buffer     ──► before[] lines  ──► Myers/DP+trim  ──► context+       ──► postMessage
(apply contentChanges          (400 ms idle,      (cached) +          + move detect +      line map +        {type:'event.append',
 to cached buffer)             1.5 s max)          after[] lines       word diff         truncation flag    seq, events[]}
onDidSave / Files / Task /
Debug / ShellExecution   ──► typed Event (no diff) ───────────────────────────────────► event card  ──► postMessage
```

1. **Ingestion (synchronous, must stay < 5 ms/burst).** For `onDidChangeTextDocument`: if `event.contentChanges.length === 0` (dirty-flag-only or undo-manager noise) → only update cached version. Otherwise, if `document.version` is not `cachedVersion + delta` (gap or `reason !== undefined`), mark the buffer `dirty` and **re-read lines at flush** instead of replaying; else apply each change to the cached **line array** (`rangeOffset`→(line,col) via a line-start index). Applying the changes ourselves is what makes undo/redo cheap [INF] (`contentChanges` describe the *pre-change* document [TYPES]).
2. **Coalescing.** One `BurstBuffer` per document (`key = scheme|authority|fsPath|languageId`). Flush on 400 ms idle **or** 1.5 s since first change **or** on save/close (flush before the card for save is emitted, so ordering in the timeline is stable) [INF].
3. **Snapshot.** `before` = cached lines before first change; `after` = `document.getText()` → split (preserve EOLs as `document.eol` info, diff on **lines without EOL chars**). Compute `+N/−N` from the diff.
4. **Diff.** (a) trim common prefix/suffix; (b) if `N+M < 1700` → DP with line-length bonus, else Myers `O(ND)` [SRC: VS Code `defaultLinesDiffComputer.ts`]; (c) shift boundaries to prefer leading/trailing equal lines ("equidistant" rule) [SRC]; (d) optional move detection; (e) for each replace block pair 1:1 lines, run `diff-match-patch` on word/char (skipped for minified/large lines).
5. **Hunks.** Build `Hunk { oldStart, oldLines, newStart, newLines, lines: [{kind:'ctx'|'del'|'add', oldNo?, newNo?, text, wordDiff?}] }` with `context = 3`, collapsible unchanged runs. Carry a **line map** (for click-to-open: `newLineNo` and `oldLineNo`) — mirror VS Code's `lineRangeMapping` idea of `originalRange`/`modifiedRange` + `innerChanges` [SRC].
6. **Webview message.** Batch: `{ v: 1, type: 'append', seq: n, events: EventDTO[] }` — events carry **precomputed hunks**, never raw file contents; the webview does zero diffing and no HTML construction from document text without escaping.

---

## 4. Diff algorithms — what transfers and what does not

| Algorithm | Facts (verified) | Where it wins | Where it loses |
| --- | --- | --- | --- |
| **Myers O(ND)** | Time O(ND), space O(N+D²)-ish; expected O(N + D²) under stochastic model; **linear-space refinement** exists (O(N) space, "roughly twice as slow"); example: 1.5 M-byte sequences in <2 min, D > 500 on VAX 4.2BSD [SRC Myers paper p.1-2]. VS Code's own comment: "O(ND) diff algorithm that has a quadratic space worst-case complexity" [SRC]. | Typical edits, few changes (D small). | Highly repetitive files (minified, generated): D ≈ N → quadratic. |
| **Wu–Manber O(NP)** | Worst-case O(NP), P = number of deletions when A is the shorter sequence; "snakes" approach; better when one side much shorter [SRC]. | Delete-heavy diffs, asymmetric sizes. | Unbounded memory for far-off diagonals; **skip in v1** [INF]. |
| **DP with line-length bonus** | VS Code uses it when `seq1.length + seq2.length < 1700`, scoring matches by `1 + ln(1+len)` and mismatches `0.99` [SRC]. | Small files: more "human" hunks than raw Myers. | O(N·M) — never for large inputs. |
| **Patience** | Find lines unique in **both** files, take longest increasing sequence as anchors, recurse, Myers between anchors [SRC git `xpatience.c`]. | Moved blocks, noisy templates, bracket-only churn. | Huge diffs where most lines are unique; slower. |
| **Histogram** | Git's default alternative: JGit port; per-side occurrence records capped at `max_chain_length = 64`; on failure `fall_back_to_classic_diff` [SRC `xhistogram.c`]. | Merge-conflict reconstruction, "which side moved" questions. | Needs GNU/LGPL-derived code if ported — license hygiene; reimplementation is ~400 LOC [INF]. |
| **diff-match-patch** | Defaults `Diff_Timeout = 1.0` s, `Diff_EditCost = 4`; `checklines` line-mode kicks in when both texts > 100 chars; `diff_cleanupSemantic` post-pass [SRC]. | Word/char refinement of single paired lines. | Whole-file line diff (line-mode loses offsets we need; also GC-ish). |
| **Moves** | VS Code computes `MovedText` when `options.computeMoves` is set, after line diff, using line hashes [SRC]. | "Block moved" instead of add+delete pair. | Costly; 40 % cap needed [INF]. |

**Line mapping concepts.** VS Code: `SequenceDiff{seq1Range, seq2Range}` → `RangeMapping` (char-level) → `LineRangeMapping{originalRange, modifiedRange, changes}` — i.e. **every change has both original and modified line ranges**, which is exactly what a history viewer needs for "click to open in the *new*" vs "open old snapshot" [SRC]. Adopt the same triple; do not model changes as only-new-side.

### 4.1 Concrete limits/defaults (my recommendation)

| Constant | Value | Rationale |
| --- | --- | --- |
| `BURST_IDLE_MS` | 400 | Typing cadence [INF]. |
| `BURST_MAX_MS` | 1500 | Agent/insert-file bursts still become ≤1 card/s. |
| `HUNK_CONTEXT` | 3 (configurable 0-10) | PROJECT.md F2. |
| `SMALL_DP_LIMIT` | `N+M < 1700` | Mirrors VS Code [SRC]. |
| `CELL_BUDGET` | `trimA*trimB > 180 000` → switch from DP to Myers-if-D-small, else bounded Myers | 180k ≈ VS Code's 1700² order of magnitude margin [INF]. |
| `MAX_D_ESTIMATE` | abort when `D > 3 000` and `N > 20 000`, emit "coarse" diff | Prevents multi-second pauses. |
| `LINE_DIFF_BUDGET_MS` | 250 (soft), 1 000 (hard abort → truncated) | VS Code uses 5 000 ms for an interactive diff editor [SRC editorOptions]; we are background. |
| `WORD_DIFF_TIMEOUT_S` | 0.05 per line pair, max 200 pairs/burst | d-m-p `Diff_Timeout` is seconds [SRC]. |
| `WORD_DIFF_MAX_LINE_CHARS` | 3 000 | Minified line → skip [INF]. |
| `MINIFIED_HEURISTIC` | avg line length > 500 or max line > 5 000 or fewest lines < 3 | Skip word diff, warn badge [INF]. |
| `NO_WORD_DIFF_LINES` | > 20 000 changed-context lines | [INF]. |
| `HEADER_ONLY_LINES` / `BYTES` | > 50 000 lines / > 10 MB | VS Code diff editor `maxFileSize` default 50 MB, `maxComputationTime` 5000 — we are stricter [SRC]. |
| `MOVE_MIN_LINES` / `MOVE_MAX_RATIO` | 6 lines; ignore if moved bytes > 40 % total | [INF]. |
| `MAX_EVENTS_STORED` | 5 000 (ring) / 20 MB JSONL | PROJECT.md F6 "capped". |
| `WEBVIEW_PAGE_SIZE` | 200 events virtualized, `overscan 20` | PROJECT.md 1 000+ events responsive. |

### 4.2 Performance budgets (project, validate in §9)

| Stage | Budget | How measured |
| --- | --- | --- |
| `onDidChangeTextDocument` handler | P99 < 5 ms | `performance.now()` around handler, log only in dev. |
| Flush (snapshot + line diff + hunks) | P95 < 30 ms for ≤2 000 lines; hard abort 250 ms | Instrument `diffMs` stored per event (no telemetry, local only). |
| `postMessage` per burst | ≤ 200 KB JSON | If larger, split into `append` + lazy `requestHunks`. |
| Initial webview render | < 300 ms (PROJECT.md) | `performance.mark` in webview, posted back once. |
| Extension activation | < 50 ms extra for our module | `vsce`/`--prof-startup`. |

---

## 5. Persistence & data model

### 5.1 Schema (versioned, discriminated union)

```jsonc
{ "v": 1, "type": "text.edit", "seq": 42, "ts": "2026-11-21T14:05:00.123Z",
  "doc": { "scheme": "file", "path": "src/app.ts", "lang": "typescript", "eol": "\r\n", "version": 118 },
  "reason": "user|undo|redo|unknown", "added": 12, "removed": 3, "truncated": false,
  "hunks": [ { "o": 10, "ol": 3, "n": 10, "nl": 5,
               "l": [ {"k":"c","t":"ctx line"}, {"k":"a","t":"+line","w":[[0,"foo "],[1,"bar"]]} ] } ] }
```

Rules: `seq` monotonic per workspace session; `v` read first (`1` accepted, `>1` → read-only "newer data" state); **no absolute paths** in storage or export (PROJECT.md F5) — store `scheme` + workspace-relative path; keep `authority` (remote) but never render it raw; timestamps ISO-8601 UTC.

### 5.2 JSONL vs workspaceState

| | JSONL in `storageUri` | `workspaceState` |
| --- | --- | --- |
| Append cost | O(1) `appendFile` | rewrites whole value [INF] |
| Size | limited by disk; our ring/compaction | **no documented cap** [TO-VERIFY]; Memento is a key-value store; large payloads cost memory & sync |
| Corruption blast radius | one line | whole value |
| Use for | event log | `{ schemaVersion, sessionId, filters, paused, totals }` |

Compaction: at 5 000 events or 20 MB, rewrite `events.jsonl.tmp` → `rename` (atomic-ish via `workspace.fs.rename` with `overwrite: true`) [INF]. **Corruption recovery**: read line-by-line, `JSON.parse` in try/catch, drop bad lines, write `events.corrupt-<ts>.jsonl` copy of the original **once** (bounded, never loop), surface one warning notification; if > 20 % lines bad → start a fresh session and archive the old file [INF].

**Export**: JSON = current filtered view + `{ exportedAt, schemaVersion, extensionVersion, settings }`; Markdown = fenced diff blocks with header `### path (+12/−3) · 14:05:00`, hunks as ```` ```diff ````, word spans rendered as `**bold**` only inside `add`/`del` lines; escape backticks and fence-collision (`~~~` if content contains ```` ``` ````) [INF].

---

## 6. Security checklist (webview + host)

1. **CSP (panel):** `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; connect-src 'none'; media-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'` — doc baseline is `default-src 'none'; img-src ${webview.cspSource} https:; script-src ${webview.cspSource}; style-src ${webview.cspSource};` [DOC webview]; our variant removes `https:` (PROJECT.md F6 "no remote content") and adds nonce [DOC sample: `script-src 'nonce-${nonce}'`].
2. **Nonce:** 32 chars from `A–Za–z0–9` per HTML generation (official `getNonce()` sample) [DOC sample]; regenerate on every `webview.html` assignment; never interpolate into `style` attributes (CSP `style-src` without `nonce` blocks them).
3. **`localResourceRoots: [Uri.joinPath(context.extensionUri, 'media')]`** — nothing else; never the workspace [DOC].
4. **No `enableCommandUris`** unless required; if used, allow-list exact command IDs (avoid `command:` injection) [TYPES `WebviewOptions.enableCommandUris`].
5. **HTML escaping:** single `escapeHtml()` for `& < > " ' `` ` `` plus attribute-context escaping; never `innerHTML` with document text; prefer `textContent`/`createTextNode`; the React bundle must not use `dangerouslySetInnerHTML`.
6. **Message validation** in host: check `typeof msg.type === 'string'` against a union, cap array lengths, reject unknown fields, and never `eval`/`executeCommand` with message-provided strings.
7. **Path normalization / boundary:** never `path.resolve` user strings; derive display paths with `vscode.workspace.asRelativePath(uri, false)`; reject/ignore URIs outside `workspace.workspaceFolders` by `Uri.fsPath` prefix **after** normalizing case on Windows (`os`-independent: compare `uri.scheme/authority` first, then normalized segments); symlinks are reported as the symlink path by watchers [TYPES] and **are not** resolved by VS Code — decide to treat symlinked/aliased paths as inside the workspace if their lexical path is inside [INF][TO-VERIFY].
8. **Secrets not needed** (no auth); do not store tokens in `workspaceState` (plaintext) [DOC remote].
9. **Untrusted workspaces:** observer that never executes workspace content can declare `"capabilities": { "untrustedWorkspaces": { "supported": true }, "virtualWorkspaces": true }` [DOC manifest/virtual-workspaces]; safer default for v1: `supported: "limited"` + disable shells/tasks cards [INF].
10. **Log hygiene:** log relative paths only; cap log at debug (`LogOutputChannel`).

---

## 7. Pitfalls (each one is a real failure mode)

| # | Pitfall | Mitigation |
| --- | --- | --- |
| P1 | **Multi-cursor / multi-edit** in one event | `contentChanges.length > 1`; apply in order against pre-change doc; never assume one range [TYPES]. |
| P2 | **Undo/redo** | `reason` available since 1.58 [TYPES]; version jumps on undo too; a burst may mix user+undo — flush **before** an event whose `reason` differs from the buffer's, then start a new buffer [INF]. |
| P3 | **`contentChanges[].range` refers to the pre-change doc** | Replay/apply in order; never compute against current text. |
| P4 | **External writes** (agent CLI, git checkout) | File-operation events do **not** fire for on-disk changes [TYPES]; watcher `onDidChange` does. De-duplicate watcher-change vs open-dirty document: if `document.isDirty`, disk content isn't the visible content — emit `file.external-change` and *do not* diff silently [INF]. |
| P5 | **Save storms** (format-on-save, autosave) | Coalesce save events per doc within 250 ms; save card is metadata only. |
| P6 | **Will-save delay/abort** (1.5 s budget, 3 strikes) [TYPES] | Use `onDidSave` for the save event; `onWillSave` only to snapshot. |
| P7 | **Huge / minified files** | Header-only card above `HEADER_ONLY_*`; skip word diff for long lines; never `getText()` a 100 MB file into the webview. |
| P8 | **CRLF/LF** | `document.eol` tells the doc's EOL; also `files.eol` auto. Split on `/\r\n|\r|\n/`; diff EOL-stripped lines; render `⏎`/`↵` markers only when a change is EOL-only [INF]. |
| P9 | **Binary / non-text docs** | `document.languageId` may be `plaintext` for binaries opened as text; guard by size + `\0` sniff on the changed text and by `languages.getLanguages()` allow-list [INF]. |
| P10 | **Untitled docs** | `uri.scheme === 'untitled'`; no path, no watcher, no save target; label `Untitled-1`; exclude from file stats. |
| P11 | **Remote / virtual workspaces** | `uri.scheme` may be `vscode-remote`, `vscode-vfs`, `git`; do not use Node `fs`/`path` on them [DOC remote]; `showSaveDialog` + `workspace.fs` still work [TYPES]; `storageUri` is remote-side. |
| P12 | **Watcher volume** | `**/*` on a `node_modules`-heavy repo floods events; use `**/*` with `files.watcherExclude`-like defaults in our own logic and debounce file events 500 ms per path [INF]. |
| P13 | **Rename = delete+create at FS level** | Prefer `onDidRenameFiles`; if a watcher pair arrives within 300 ms with same size, coalesce into rename [INF]. |
| P14 | **Doc closed before flush** | `onDidCloseTextDocument` may not fire on tab close [TYPES]; also flush on `window.onDidChangeVisibleTextEditors` when last visible editor for a dirty doc disappears; `document.isClosed` check before reading text [TYPES]. |
| P15 | **`webview.html` reload wipes state** | Keep webview state in `setState`, and re-request the visible page on `onDidReceiveMessage({type:'ready'})` [DOC]. |
| P16 | **FileDecoration badge length** | "very short string"; badges > ~2 chars get truncated by UI [TYPES doc text]; keep tooltip for detail. |
| P17 | **Language change** (`setTextDocumentLanguage`) fires open/close events [TYPES] | Ignore as change; update cached `languageId`. |
| P18 | **Terminal `commandLine.confidence`** | Low-confidence lines may be empty/partial at start event; only commit card text at `onDidEnd` [TYPES]. |
| P19 | **`AcquireVsCodeApi` twice** throws | Single module-level instance exposed through a context [DOC]. |
| P20 | **Nonce missing on inline `<style>`** | Put all CSS in an external `media/main.css`; no inline handlers (`onclick=` is blocked without `script-src 'unsafe-inline'`) [DOC]. |

---

## 8. Open questions needing runtime validation

1. **`workspaceState` size limits** [TO-VERIFY]: no official number found in API reference; measure the practical ceiling (and sync behaviour) before relying on Memento for anything > 100 KB.
2. **`reason` completeness** [TO-VERIFY]: does every undo arrive with `reason === Undo` in 1.93+? Do undo-manager elements group multi-cursor undo into one event? Instrument in a dev host across 1.86 → 1.147.
3. **Watcher vs `workspace.fs` writes**: confirm on-disk changes from a script *outside* VS Code fire `FileSystemWatcher.onDidChange` and *not* `onDidCreateFiles` on Windows (case-insensitive paths, WSL mounts, UNC paths) [TYPES says not fired; needs empirical check].
4. **RTL support in webviews** [TO-VERIFY]: no doc statement found; verify `body.vscode-*` classes and `--vscode-*` vars behave under `<html dir="rtl">` and that scrollbars/`overflow` don't fight inline direction; test `fa` language pack.
5. **`cspSource` under remote/browser clients** (e.g. `vscode-cdn.net` origins): confirm our CSP (`connect-src 'none'`) doesn't break webview view vs panel loading of `asWebviewUri` assets.
6. **Terminal card availability matrix**: shell integration off (default in some shells/Windows), no shell, `cwd` undefined — confirm `onDidChangeTerminalShellIntegration` still fires after the first prompt so we can attach late.
7. **`onDidCloseTextDocument` guarantees** (doc says "no guarantee on tab close" [TYPES]): empirically find what *does* fire on tab close with unsaved changes, to avoid leaking buffers.
8. **Diff quality benchmark**: run Myers+DPlen vs Patience vs Histogram on 3 corpora (minified JS, generated `.d.ts`, 200-line refactor) and record P50/P95 ms + "human agreement" score before locking D4/D7.
9. **`getState()` size** practical ceiling for the webview (JSON only; no doc text) and whether `postMessage(true/false)` unreliability needs an ack protocol [TYPES `postMessage` returns `Thenable<boolean>`, "true does not mean received"].
10. **`engines.vscode` final decision**: whether Marketplace traffic justifies supporting < 1.93 (then terminal + undo reason gating is mandatory).

---

## 9. Supervisor review and decisions (2026-11-21)

Reviewed against `docs/ARCHITECTURE.md` and `docs/design/ui-spec.md`. API matrices, version
bisection, and doc citations are accepted as evidence. Design deltas:

- **Adopted:** `engines.vscode ^1.93.0`; snapshot-by-re-read; DP under N+M<1700 with 180k cell
  guard; Myers beyond; 1.5 s hard flush; coarse fallback instead of blocking; hunks with both
  old/new line ranges; no dependency on `diff-match-patch` (own token diff, smaller surface);
  `localResourceRoots`; strict no-network CSP; `onWebviewPanel` activation; `workspace.fs` export.
- **Overridden:** idle debounce is **300 ms** (not 400) for a snappier live feel; `maxEvents`
  default **1000** metadata with only the newest **300** diff payloads retained (not 5000 events
  with diffs); persistence is one versioned JSON snapshot capped at **8 MB**, not JSONL (simpler
  recovery, no compaction log). The 20k/50k line and 10 MB diff ceilings are superseded by the
  `maxFileSizeKB` tracking gate; only displayed lines are capped at 500.
- **Deferred:** move detection, `FileDecorationProvider`, historical side-by-side diff via
  `TextDocumentContentProvider`, worker threads. These are recorded in ARCHITECTURE.md §14.

## 10. Sources (accessed 2026-11-21)

**Official docs / notes**
- Webview API — https://code.visualstudio.com/api/extension-guides/webview (security, CSP, nonce, `retainContextWhenHidden`, `getState/setState`, theming, a11y classes)
- Webview sample source — https://raw.githubusercontent.com/microsoft/vscode-extension-samples/main/webview-sample/src/extension.ts (`getNonce`, CSP line)
- VS Code API reference — https://code.visualstudio.com/api/references/vscode-api (anchors `#workspace.onDidChangeTextDocument`, `#window.onDidStartTerminalShellExecution`, `#Webview.asWebviewUri`, `#l10n.t`, `#Memento`)
- Built-in commands — https://code.visualstudio.com/api/references/commands (`vscode.diff`, `vscode.open`)
- Extension manifest — https://code.visualstudio.com/api/references/extension-manifest (`engines`, `capabilities`, `extensionKind`)
- Remote Development & Codespaces — https://code.visualstudio.com/api/advanced-topics/remote-extensions (`workspace.fs` routing, `storageUri`)
- Virtual workspaces — https://code.visualstudio.com/api/extension-guides/virtual-workspaces (`virtualWorkspaces` capability)
- Workspace Trust (capabilities) — see manifest page link `#untrustedWorkspaces`
- l10n-dev (bundle format, `"l10n"` field) — https://github.com/microsoft/vscode-l10n/blob/main/l10n-dev/README.md
- Release notes: https://code.visualstudio.com/updates/v1_52 (FileDecoration final; undo of file ops), `v1_73` (l10n finalized), `v1_74` (l10n stabilized recap), `v1_93` (terminal shell integration API stable), `v1_147` (latest stable; inspected for relevant API changes — none affecting our surface)

**VS Code source (behavioural specifics)**
- Line diff strategy switch at 1700, DP scoring, refinement, moves — https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts
- Myers implementation/comment — `.../algorithms/myersDiffAlgorithm.ts`
- Diff editor defaults (`maxComputationTime` 5000, `maxFileSize` 50 MB, `ignoreTrimWhitespace` true) — https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/editor/common/config/editorOptions.ts
- Typings inspected locally: `%LOCALAPPDATA%\Programs\Microsoft VS Code\8a14f0cc1b\resources\app\out\vscode-dts\vscode.d.ts` (VS Code **1.147.0**); `@types/vscode` bisection over `https://unpkg.com/@types/vscode@<v>/index.d.ts` (1.49–1.146, latest published 1.146.0)

**Diff algorithms / libraries**
- E. W. Myers, *An O(ND) Difference Algorithm and Its Variations* (1986) — http://www.xmailserver.org/diff2.pdf (abstract: O(ND) time/space, O(N+D²) expected, O(N)-space refinement, 1.5 M-byte example)
- S. Wu, U. Manber, G. Myers, W. Miller, *An O(NP) Sequence Comparison Algorithm*, IPL 35 (1990) — https://publications.mpi-cbg.de/Wu_1990_6334.pdf
- Git patience — https://raw.githubusercontent.com/git/git/master/xdiff/xpatience.c
- Git histogram (JGit port, `max_chain_length = 64`, classic fallback) — https://raw.githubusercontent.com/git/git/master/xdiff/xhistogram.c
- Google diff-match-patch JS (defaults `Diff_Timeout = 1.0`, `Diff_EditCost = 4`, line mode > 100 chars) — https://raw.githubusercontent.com/google/diff-match-patch/master/javascript/diff_match_patch_uncompressed.js
- Package versions checked 2026-11-21 via npm registry: `diff@9.0.0`, `diff-match-patch@1.0.5`, `@vscode/l10n@0.0.18`, `@types/vscode` latest `1.146.0`
