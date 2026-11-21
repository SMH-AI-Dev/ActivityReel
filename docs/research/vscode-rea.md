# VS Code Internals — REA / Static Research (for ActivityReel)

Research date: 2026-11-21. Tags: **[Observed]** = seen directly in shipped files; **[Inferred]** = reasoned from observed code/strings, not verified at runtime; **[Unknown]** = not established.

## 1. Scope and target

Locally installed VS Code Electron app, unpacked (no ASAR for the main app):

- Root: `C:\Users\SMH\AppData\Local\Programs\Microsoft VS Code\8a14f0cc1b\resources\app`
- Version: **1.147.0** stable, commit **8a14f0cc1b08d531eb83255ea3764ae22aa932b5**, date **2026-11-17T02:46:11Z** (from `product.json`) [Observed]
- Main bundles: `out/vs/workbench/workbench.desktop.main.js` (~22.9 MB minified), `out/vs/workbench/api/node/extensionHostProcess.js` (~2.4 MB), `out/vs/platform/agentHost/node/diffWorkerMain.js` (~151 KB), `out/vs/editor/common/services/editorWebWorkerMain.js`
- Built-in extensions: `extensions/*` (git, git-base, diff, markdown-language-features, copilot, ms-vscode.vscode-js-profile-table, simple-browser, ...)
- Note: `out/vs/workbench/contrib/**` and `out/vs/editor/browser/**` exist only as **directories/CSS**, not JS sources — all contrib code is bundled into `workbench.desktop.main.js`. [Observed]

Goal (per `docs/PROJECT.md`): evidence for ActivityReel's live timeline, diff rendering, SCM counts, and webview work.

## 2. Method and evidence

### 2.1 REA CLI attempt — incomplete (time-boxed stop)

Command (per instructions):

```
npx -y rea-agents@6.5.0 analyze-javascript-application "C:/Users/SMH/AppData/Local/Programs/Microsoft VS Code/8a14f0cc1b/resources/app" --json > /tmp/lprea/rea-app.json
```

- Exit code **124** (killed by `timeout 700`, i.e. ~11.7 min). `rea-app.json` is **0 bytes**; progress went to stderr. [Observed]
- Phases seen: `analyze_javascript_application` → `read_javascript_artifacts` → `parse_javascript_sources` ("Parsing and projecting **6273** selected application source files") → `parse_javascript_source`. [Observed]
- Stopped at sequence ~4607 / 6273 (**~73 %**), still inside `node_modules.asar/playwright-core/**` (a dependency tree bundled under `resources/app/node_modules.asar`). [Observed]
- **Limitation:** no Application Graph / export-shape evidence was produced. Root cause [Inferred]: the analyzer inventories the whole app including `node_modules.asar` (Playwright + others), so a single monolithic VS Code bundle plus huge dependency trees does not fit the time box. A narrower run (e.g. `extensions/git-base` or one extension dir) would plausibly finish; not attempted here to stay time-boxed.

### 2.2 Fallback: targeted static inspection

`grep -o`/Node `indexOf` + fixed-size slices on the bundles above (no whole-file reads except small package.json/media files). All file:line references below are **byte offsets** into `workbench.desktop.main.js` (the file is one line), marked `@<offset>`.

## 3. Findings

### Q1. Timeline view: model, grouping, paging, refresh

- **View/registry IDs** [Observed]: view container id `"timeline"` (`VLe="timeline"`), view/service id `ue("timeline")` held by token `zW`, command ids `files.openTimeline`, `timeline.refresh`, `timeline.focus`, `timeline.toggleFollowActiveEditor`, context keys `timelineHasProvider`, `timelineHasWorkspaceProvider`, `timelineFollowActiveEditor`, `timelineFocused`, `timelineCanCompareSelection`, `timeline.item.editing`-like values; menus `timeline/item/context`, `timeline/title`. Extension activation event on show: `onView:timeline`. [Observed]
- **Service** `TimelineService` (`registerTimelineProvider`, `registerWorkspaceTimelineProvider`, `getTimeline(id, uri, options, token)`, `setUri`, `getSources()`) @~20962504 [Observed]:
  - two provider maps: per-**file** `providers` (with `scheme` filter: `"*"` or list) and **workspace** `workspaceProviders` (`provideWorkspaceTimeline`). `uri === undefined` selects the workspace provider.
  - provider change pushes: `onDidChange(uris)` → `_onDidChangeTimeline.fire({id, workspace:false, uris})`; workspace variant fires without uris.
  - **Normalization in the service**: each item gets `source = providerId`; items are sorted **descending by `timestamp`**, ties broken by `source` with `numeric:true, sensitivity:"base"` locale compare.
- **Options contract** [Observed]: `{ cursor?: string, limit?: number, triggerKind: 1|2, cacheResults?: boolean, resetCache?: boolean }` — `triggerKind` 1 = initial/`loadTimeline(e,…)` default path, 2 = explicit reload; paging is **cursor-based**, provider returns `{items, cursor?}` where `cursor !== undefined` ⇒ "more".
- **Pane** `TimelinePane` @~20965000–20983000 [Observed]:
  - settings registered: `"timeline"` section with `timeline.pageSize` (default **50**, nullable) and `timeline.pageOnScroll` (default **true**); also `timeline.excludeSources` (JSON array of provider ids) and `timeline.toggleFollowActiveEditor`; `$Fr = 22` is the per-row height estimate used when `pageSize` is null: `max(20, floor(renderHeight/22 + (pageOnScroll ? 1 : -1)))`.
  - **Paging**: `loadMore(item)` → `_maxItemCount = _visibleItemCount + pageSize` and re-request; in-flight request for a source is cancelled and its `limit` summed (`n.limit = pending.limit + limit`); requests carry a `CancellationTokenSource` and are tracked in `pendingRequests`.
  - **Never re-requests** when `!more` or when cached items already exceed `lastRenderedIndex + pageSize`.
  - **Merging**: per-source bucket class (`Cnn`) keeps `items`, `cursor`, `more`, `newest`, `oldest`, `stale`; `add(response)` dedupes by `id`, else by `timestamp`, splices duplicates out of the existing array, then inserts/merges. Multi-source view is a k-way merge by timestamp into one flat list (single source = plain iteration).
  - **Grouping** is display-only: `qFr(item, prevLabel)` computes `relativeTime` and sets `hideRelativeTime` when it equals the previous item's label — i.e. relative-time "sticky" labels, not real tree groups.
  - **Refresh triggers** [Observed]: service `onDidChangeTimeline`; `onDidActiveEditorChange` (follow-active-editor); view focus (`onDidFocus` → `refreshDebounced`); `onDidChangeConfiguration` for `timeline.pageOnScroll` / `explorer.decorations`; provider add/remove; `setExpanded`/`setVisible`; explicit `timeline.refresh` command → `reset()` → `loadTimeline(true, undefined, 1)`.
  - **Debounce**: `refreshDebounced` is decorated `of(500)` (bind-debounce decorator, 500 ms) @~20982630; also `reloadTimeline` keeps current item count as new limit.
  - **Stale-response guard**: `handleRequest` drops results whose `request !== pending` or `e.uri !== this.uri`; if a refresh is pending and no requests remain it re-runs `refresh()`; otherwise only `tree.rerender()`.
  - **Hidden-view behavior**: `isBodyVisible()` false ⇒ no loading; children cleared when not visible. [Observed]
- **Git built-in provider** (`extensions/git/dist/main.js`) [Observed]:
  - class `Rl` with `id="git-history"`, `label=l10n.t("Git History")`; implements both `provideTimeline` (per file) and `provideWorkspaceTimeline` (per repo, cursor = JSON map `root → skip offset`, constant `ON = 50`).
  - paging pattern: request `limit + 1`, use last `hash` as `cursor`, `splice` the extra element off — the classic "ask for one extra" end-of-list test.
  - `TimelineItem` subclass carries `ref`, `previousRef`, `message`, `id`, `contextValue` (`git:file:commit`, `git:file:index`, `git:file:working`, `git:folder:commit`), `resourceUri` = `file` + `?<hash>` custom-ish URI, `command` = resolved "open diff" command chosen by a command resolver (`resolveTimelineOpenDiffCommand`).
  - synthetic top items: "Staged Changes" and (optionally) "Uncommitted Changes" prepended on the first page only (`cursor === undefined`).
  - refresh: repository change ⇒ `fireChanged()`; status change ⇒ only if `git.timeline.showUncommitted`; git operation completed (not error, not read-only, kind≠`Status`) ⇒ `fireChanged()`; both `fireChanged` and `fireWorkspaceChanged` are `@debounce(500)`.
  - workspace merge: k-way merge across repos by author/commit-date (`MN(...)`).
- **Local History** [Observed as present, `timeline.localHistory` is a source id **inside the core bundle**]: settings `workbench.localHistory.{enabled,exclude,maxFileEntries,maxFileSize,mergeWindow}`, commands `localHistory.{open,compareWithPrevious,compareWithSelected,restore}`. It is a core timeline source, not an extension.

### Q2. Diff computation and presentation

- **Algorithms (all in `workbench.desktop.main.js`)** [Observed] @~850959:
  - accessor object `IO = { getLegacy:()=>new nti, getDefault:()=>new WGe, getAdvancedExternal:()=>koo(false), getAdvancedWasm:()=>koo(true) }`.
  - selector `Uhn(algorithm)` @~891111: `"legacy" | "advanced" | "advanced-external" | "advanced-wasm"` (also seen at `mergeEditor.diffAlgorithm` where default is `"advanced"`).
  - setting `diffEditor.diffAlgorithm` enum exactly those four; `diffEditorDEFAULTS.diffAlgorithm = "advanced"` (`NOe="advanced"`); migration map `{smart:"legacy", experimental:"advanced"}`.
  - `advanced-external` / `advanced-wasm` lazily `import` `@vscode/diff` and build a `DiffComputer` (`createDiffComputer({useWasm})`) — a **WASM port** renders `{edits.replacements}` back into line/char mappings; **falls back to `getDefault()`** when the external computer throws or the self-verification says `"invalid"` (`Ahn(...)` re-applies inner changes and compares text; result is `"valid" | "invalid" | "unverified"`).
- **[Supervisor spot-check, direct bundle read]** The 1700 threshold and weighted DP are real: `sumLineCount < 1700 ? dynamicProgrammingDiffing : myersDiffingAlgorithm`, with trimmed-line identity and line-length-weighted scoring `1+log(1+len)` (exact empty line 0.1). A 5000 ms computation budget object is passed down. Keep this as inspiration, not a copy target.
- **Inside the built-in advanced algorithm (also shipped standalone in `diffWorkerMain.js`)** [Observed]:
  - class `Qe` holds `dynamicProgrammingDiffing` + `myersDiffingAlgorithm`; `_computeDiff` chooses: line-count sum `< 1700` ⇒ **dynamic programming** (line-length-weighted scoring `1+log(1+len)`, exact-equal 0.1), else **Myers**; both receive a cancellation "time budget" object created from `maxComputationTimeMs` (`0` ⇒ never time out).
  - line identity is computed on **trimmed** lines (whitespace-insensitive hashing); `ignoreTrimWhitespace` controls a later pass.
  - **Histogram-based move detection**: `computeMoves` pass uses a char-histogram similarity class (`histogram`, `computeSimilarity`) over ranges, plus a knapsack/`computeMoves` idea (`His`-style range sets) — only when `options.computeMoves` is true.
  - **Word-level**: `refineDiff` produces `innerChanges` (char ranges per line pair); refinement functions `findWordContaining` and optional `findSubWordContaining` (`extendToSubwords`).
  - results are `LineRangeMapping`-like objects `{original, modified, innerChanges}`; counts are derived by subtracting `endLineNumberExclusive - startLineNumber`.
- **Presentation** [Observed string evidence]: `diffEditor.renderSideBySide`, `renderSideBySideInlineBreakpoint`, `useInlineViewWhenSpaceIsLimited`, `experimental.useTrueInlineView`, `hideUnchangedRegions.{enabled,revealLineCount,minimumLineCount,contextLineCount}`, `collapseAllUnchangedRegions`, `showAllUnchangedRegions`, `experimental.showMoves`, `renderIndicators`, `renderMarginRevertIcon`, `codeLens`, `maxComputationTime` (**default 5000 ms** appears as `ULo=1e3`/settings defaults; the default is "5s" in settings defaults), `maxFileSize` (default 50 MB, max 1 GiB clamp `1073741824`), `ignoreTrimWhitespace`, `wordWrap: off|on|inherit`, and colors `diffEditor.insertedLineBackground`, `removedLineBackground`, `insertedTextBackground`, `removedTextBackground`, `insertedTextBorder`, `removedTextBorder`, `unchangedCodeBackground`, `unchangedRegionShadow`.
- **Worker-based diff**: `workbench.desktop.main.js` computes via `_editorWorkerService.computeDiff(lhs, rhs, options, algorithm)`; standalone worker `out/vs/platform/agentHost/node/diffWorkerMain.js` exists for the agent host, and `out/vs/editor/common/services/editorWebWorkerMain.js` is the editor's main-thread-offload worker. [Observed] Runtime threading behavior not observed.

### Q3. Per-file added/deleted counts (SCM / decorations / chat)

Three distinct mechanisms exist; they disagree in meaning, which matters for ActivityReel.

1. **Quick-diff decorator model (gutter/overview markers)** @~4921204 [Observed]: `IQuickDiffModelService` (`DW`) with `createQuickDiffModelReference(uri, options)`; default options constant `ris = {algorithm:"advanced", maxComputationTimeMs:1000}`. Model:
   - `_diffDelayer = new Debouncer(200)`; every `textEditorModel.onDidChangeContent`, `onDidChangeEncoding`, `quickDiffService.onDidChangeQuickDiffProviders`, chat-editing-session state, and `scm.diffDecorationsIgnoreTrimWhitespace`/`diffEditor.ignoreTrimWhitespace` config change → `triggerDiff()` → debounced `diff()`.
   - `diff()` calls `computeDiff` per provider with `{computeMoves:false, ignoreTrimWhitespace, maxComputationTimeMs}`, keeps results per `providerId` (`primary`/`secondary` kinds; secondary changes that byte-equal a primary change's original text are demoted into a separate list), sorts changes, exposes `allChanges`, `changes`, `mapChanges`, `changesVersionId`, `quickDiffs[]` = `{providerId, providerKind, original, modified, changes, changes2}`.
   - Version-id stamping: result is discarded if the model version changed while awaiting.
2. **Chat-editing per-file counters** @~15214282–15216000 [Observed]: class with `lineChangeCount`, `linesAdded`, `linesRemoved`; `updateLineChangeCount(diffResult)` loops `diffResult.changes` and accumulates `modified.endLineNumberExclusive - modified.startLineNumber` (added) and the original equivalent (removed), `lineChangeCount += max(added, removed)`. `_updateDiffInfo()` calls `computeDiff(original, modified, {ignoreTrimWhitespace:false, computeMoves:false, maxComputationTimeMs:3000}, "advanced")` and only commits if both model version ids are unchanged.
3. **SCM provider counts/badges** @~scm activity contribution [Observed]: `scm.countBadge` = `all | focused | off`; sum of `provider.count` (if provided) else `resourceCount`, pushed to the Activity Bar badge and status bar. `providerCountBadge`, `scm.diffDecorations` (27 hits), `scm.diffDecorationsIgnoreTrimWhitespace`, `explorer.decorations.badges`. Folders/files get colors from `gitDecoration.addedResourceForeground` etc. contributed by `extensions/git/package.json` `contributes.colors`.

**Takeaway:** VS Code never adds/subtracts a per-edit delta for its "changes" numbers; it re-diffs original-vs-current snapshots on a debounce and recomputes counts. Chat editing has a third notion (`D_` with `linesAdded, linesRemoved, charsAdded, charsRemoved` used as telemetry delta).

### Q4. Webview architecture facts to mirror

- **API surface** (`extensions/vscode-dts`/`out/vscode-dts/vscode.d.ts` in app, `asWebviewUri`, `cspSource`, `getState`, `setState`) [Observed]:
  - `html`, `options { enableScripts, localResourceRoots, enableForms, enableCommandUris, portMapping }`, `options` serialized to the host via `$setOptions`; `postMessage` → `$postMessage`; `onDidReceiveMessage`.
  - `getState()`/`setState()` documented: JSON-serializable, restored on revive; no auto setState when webview is destroyed (host persists last setState for serialized webviews).
  - `asWebviewUri(localResource)` + `cspSource` (host `YS`) used in CSP; legacy `vscode-resource:` and `vscode-webview-resource:` URIs are rewritten by the host @~1735796 (compat only — do not use).
  - `acquireVsCodeApi()` is injected once and **deleted** after the page claims it (`delete globalThis.acquireVsCodeApi`) [Observed in worker path @~9311257]; called `acquireVsCodeApi()` w/o custom args.
- **CSP pattern used by a first-party webview** (`extensions/markdown-language-features/dist/extension.js` @~2091622) [Observed]:
  `default-src 'none'; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; img-src ${cspSource} https: data:; media-src ${cspSource} https: data:; script-src 'nonce-${nonce}' ${cspSource}; worker-src ${cspSource} blob:; connect-src ${cspSource}; frame-src 'self';`
  plus `<meta name="vscode-*-script-nonce">` and a per-load **message secret** in a meta tag; `options = { enableScripts:true, localResourceRoots: [extensionUri, ...trusted providers] }`. Host failure page uses `default-src 'none'` only. [Observed]
  The webview-views panel builder is not in the main bundle as plain strings (no `enableScripts:` literal), so the *generic* host CSP could not be located [Unknown] — but the markdown pattern above is the canonical extension-side template.
- **Theme CSS variables** [Observed]: host builds `webviewThemeData.styles` = for every theme color `c: "vscode-" + id.replace(".","-") => color.toString()`, plus `vscode-font-family`, `vscode-font-weight`, `vscode-font-size` (13px default), `vscode-editor-font-{family,weight,size}`, `text-link-decoration`, size tokens, `vscode-editor-font-feature-settings` @~11954126. Body classes include `vscode-light`, `vscode-dark`, `vscode-high-contrast`, `vscode-high-contrast-light`, plus `vscode-reduce-motion` and `vscode-using-screen-reader` (webview bootstrap `webview/browser/pre/index.html` ~L507–523). [Observed]
  Variable naming note: theme **colors** use `"vscode-"+id.replace(".","-")` (first dot only) while theme **sizes** use `id.replace(/\./g,"-")` @~11953892 [Observed]. Theme color ids are `namespace.name` with a single dot, so the practical result is the hyphenated form (`--vscode-gitDecoration-addedResourceForeground`, `--vscode-editorGutter-addedBackground`). **Supervisor correction, verified by direct bundle inspection: use hyphenated names as in the UI spec; the earlier "dotted form" inference was wrong.**
  `--vscode-charts-green` appears; `--vscode-charts-red` **not found** in the bundle [Observed] — use `charts-red` only via theme, or fall back to a contrast-safe token. [Inferred]
- **Retention / lifecycle** [Observed]: `retainContextWhenHidden` is honored by the overlay (`webviewView`, `customEditor`, `webviewPanel` options); when false the host clears the webview and resets app state on hide (`_releaseWebview` → `_resetApp`). A restart participant flags `webview.retainedContext` for unattended restarts. Chat overlay toggles retention dynamically (`_updateRetention`) based on whether tools are active. Messages posted before first load are queued (`_firstLoadPendingMessages`) and flushed. Find widget state is restored only when retention is on.
- **RTL** [Observed]: the word "rtl" appears **8** times in the whole main bundle; the only real handling is the editor's inline-view line renderer: `r.textDirection===1 ? 'dir="rtl"' : (containsRTL ? 'dir="ltr"')`, plus padding-right tweak. There is **no** `dir` on webviews, no `vscode-rtl` class, no `isRTL` helper. ⇒ VS Code gives ActivityReel **no** RTL infrastructure beyond CSS `direction`/`unicode-bidi` the webview itself applies. [Observed]
- **A11y** [Observed]: 29 `aria-live` uses in core (e.g. status/message blocks with `aria-live="polite"`, `role="alert"` + `aria-atomic`); no timeline-specific live region found (`a11yStatus` absent).

### Q5. Built-in extension patterns worth copying conceptually

- **git (`extensions/git`)** [Observed]: provider split into file-level and workspace-level; cursor paging with `limit+1`; only first page injects synthetic "current state" items; UI-agnostic change signal decoupled from data (`onDidChange` with and without `uris`); **500 ms debounce on the change signal**; diff opening delegated to a command resolver so provider doesn't know editor internals; `*` activation established by the SCM/timeline API the extension provides, and it also registers `contributes.colors` for its decorations.
- **markdown-language-features** [Observed]: static `index.html` + `asWebviewUri` assets + nonce CSP + meta-tag initial state + message secret; options set once per content version; `localResourceRoots` scoped to extension dir (plus workspace only when trusted).
- **ms-vscode.vscode-js-profile-table** [Observed]: small webview front-ends sharing one theme-var vocabulary (`--vscode-input-*`, `--vscode-focusBorder`, `--vscode-editor-font-*`).
- **copilot suggestion panel webview** [Observed]: 41 distinct `--vscode-*` vars, includes `--vscode-contrastBorder`/`contrastActiveBorder` for HC support.
- **Debug auto-launch / merge-conflict**: `onStartupFinished` is the only activation mode used for "always-on small feature" (activation events are auto-generated from contributions elsewhere in 1.147; `*` still used by git/copilot). [Observed]

## 4. Design takeaways for ActivityReel

- **Event model**: mirror the Timeline shape but keep ActivityReel's own store as source of truth. Recommended item contract: `{ id, source, timestamp, label, description?, resourceUri?, refs?, command?, contextValue?, iconPath? }`; provider contract `{ items, cursor? }` with `cursor` meaning "more exist". Sort **descending by timestamp**, tie-break by source for stable rendering.
- **Coalescing**: two-tier debounce mirrors VS Code exactly — provider change signal debounced **500 ms**, quick-diff computation debounced **200 ms**, plus ActivityReel's own burst merge per document (PROJECT.md). Keep the "pending request supersedes, then refresh after pending resolves" rule to avoid result storms.
- **Diff pipeline**: line diff first (Myers with prefix/suffix trim; the 1700-line DP threshold is a reasonable heuristic to copy at the *policy* level), `ignoreTrimWhitespace` and `maxComputationTimeMs` as first-class options with defaults `1000` (inline quick diff) / `3000–5000` (panel); always stamp a model `versionId` and drop stale results; word-level via `innerChanges` + `findWordContaining`-style refinement, sub-word optional; soft timeout returns partial results flagged as such (VS Code's `isValid`-style verification/fallback idea).
- **Counts**: compute `+N/−N` as `Σ(modified.endLine − modified.startLine)` over final change ranges of `original → current` snapshot, `lineChangeCount = Σ max(added, removed)`. Do **not** accumulate per-keystroke deltas (drift). Record counts fail/partial when the diff hit its time or size limit.
- **Webview protocol**: typed `{ type: 'init' | 'snapshot' | 'append' | 'patch' | 'settings' }` host→webview and `{ type: 'ready' | 'requestMore' | 'openFile' | 'filterChanged' | 'setState' }` webview→host; send an initial `snapshot` then incremental `append`/`patch` only; host keeps last-sent sequence number; webview state via `getState/setState` for filter/search/scroll anchor only (not the event log). Prefer `retainContextWhenHidden:false` + state restore (VS Code's own default) and measure; large panels in VS Code opt into retention, but that costs memory.
- **Theming**: consume only `--vscode-*` variables, no hex literals; include `--vscode-contrastBorder` / `--vscode-contrastActiveBorder` borders under `body.vscode-high-contrast*`; use `--vscode-font-*` and `--vscode-editor-font-*` for code; add / removed should use `--vscode-diffEditor-insertedLineBackground` / `--vscode-gitDecoration-addedResourceForeground` (hyphenated; verified) with fallbacks. Honor both `prefers-reduced-motion` and the `vscode-reduce-motion` body class (VS Code adds it; our CSS must honor it).
- **RTL**: must be implemented by ActivityReel entirely — `dir` on the webview root from locale/config, logical CSS properties (`margin-inline`, `inset-inline`, `padding-inline`), `unicode-bidi: plaintext` for file paths and code lines, mirrored chevrons for collapse, and numeric chips pinned with `direction:ltr` inside RTL text.
- **Performance limits**: page size 50 default; virtualize; per-provider `limit+1` cursor; cap pending requests to 1 per source; per-item relative-time label computed and hidden when duplicate (cheap, avoids a separate grouping pass); diff chunk/first-view state as in markdown editor (`localResourceRoots`).

## 5. Risks and open questions

- **REA incomplete**: no Application Graph; all findings are from minified bundling, so exported symbol *shapes* are unverified. Re-run on a narrower target if graph data is needed.
- **Minification renaming**: class names like `Cnn`, `Rl`, `DW`, `IO`, `Qe` are local aliases; semantic names (`TimelineService`, `IQuickDiffModelService`, `DiffComputer`) come from retained string literals/log calls, not from identifiers.
- **Exact default of `diffEditor.maxComputationTime`** (5 s per settings copy) vs `quickDiff` `maxComputationTimeMs` (1000) vs chat (3000) — verify in Settings UI before quoting [Unknown].
- **`--vscode-*` var naming with multiple dots**: implementation replaces the first `.` only; screenshots/DevTools confirmation needed before relying on dotted names [Inferred].
- **Generic webview-view CSP**: not found as plain strings in the main bundle [Unknown]; markdown preview CSP is the reliable first-party template.
- **Runtime behavior** (debounce timings, retention memory cost, diff worker threading) not exercised — static only; ActivityReel must benchmark its own budgets (PROJECT.md §7).
- **Licensing**: everything read here is MIT-licensed VS Code / Microsoft, but no code should be copied wholesale; this report intentionally records identifiers and behaviors only.
