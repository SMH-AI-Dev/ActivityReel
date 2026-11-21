# AI Editor Review UX — Research for CodeTrail

Research date: **2026-11-21**. How AI editors present and let users review live AI
changes, the state model behind review, their trust mechanisms, and which patterns a
read-only observer like CodeTrail can adopt.

| Tag | Meaning |
| --- | --- |
| `[Observed]` | Read directly from an installed artifact on this machine (ASAR strings/code, files). |
| `[Documented]` | Stated on an official vendor documentation page fetched 2026-11-21. |
| `[Inferred]` | Reasoned conclusion from observed/documented evidence, not stated outright. |
| `[Unknown]` | Could not verify; no claim made. |

`[Documented]` means "the vendor says so", not "verified behavior". Qoder facts are
string/code observations of **0.4.11** (build 2026-10-23), not a public API contract.


## 1. Targets and evidence method

### 1.1 VS Code native baseline — `[Observed]`

Local install present: `%LOCALAPPDATA%\Programs\Microsoft VS Code`. The extension API has
`onDidChangeTextDocument` (ranges), `FileSystemWatcher`, `isDirty`, save/task/debug/terminal
events, but **no first-party "AI change set"**. Native review primitives are Git-oriented:
SCM staged/unstaged/untracked lists, `vscode.diff`, save-based timeline, merge markers.
`[Inferred]` VS Code gives *documents and diffs*, not *agent turns* — session shape must be
reconstructed by the extension.

### 1.2 Qoder — `[Observed]` (primary target)

Artifact: `C:\Users\SMH\AppData\Local\Programs\Qoder\resources\app.asar`
(181 MB / 189,476,921 bytes; Electron 43.1.1; product version 0.4.11).

Method (read-only; no vendor code copied):

1. Listed the install folder (`product.json`, `build-manifest.json`, `extensions/`,
   `bundled-resources/`, `qoder-helper/skills/`), then parsed the ASAR header with Node
   (6,420 entries) to map the archive **without executing vendor code**.
2. Extracted 6 bundles to a temp dir outside the project: `out/main/electronMain.js`,
   renderer assets `Cux9x6wn.js` (15.0 MB), `Xom1o5KH.js`, `QWhgX92t.js` (locale
   strings), `CvkcMRxh.js`, `C_m_b--Z.js`.
3. Grepped the requested terms and traced surrounding state shapes; extracted the
   **English and Chinese locale blocks** to recover exact user-facing wording.

REA CLI (`rea-agents@6.5.0 ... --json`): the first run **failed** with
`artifact_integrity_mismatch` on an unpacked `libvips` DLL (packaged native binaries are
modified post-write). Re-run with `--integrity-policy record-and-continue` **succeeded**
(exit 0, ~370 MB JSON, ~9 min). `[Observed]` `authority: shipped-artifact`,
`confidence: derived`, 4,469 relevant files, 4,155 parsed JS files, 12.3M AST nodes,
32,583 findings. Caveats: semantic graph truncated at a 100k-node budget
(`coverage: partial`) so symbol queries returned nothing; REA also reported 0 IPC
channels / 0 preload entry points despite an active renderer — **IPC conclusions from
REA are unreliable for this build**. REA is used here only to corroborate scale and
packaging; all review-UX facts come from the string extraction.

`extensions/` and `bundled-resources/archives/` hold plugins (`qoder.canvas`,
`qoder.sites`, `qoder-context-plugin`, …) with **no review-UX logic** `[Observed]`.


### 1.3 Cursor — `[Documented]` only (not installed)

Absence verified `[Observed]`: no `Program Files\Cursor` or `%LOCALAPPDATA%\Programs\Cursor`;
no installer downloaded. Sources fetched 2026-11-21: `cursor.com/docs/agent/overview`,
`cursor.com/help/ai-features/agent`, `cursor.com/help/security-and-privacy/privacy`.
Note: `docs.cursor.com/*` 308-redirects to `cursor.com/docs`; `.../agent-review.md` is 404.

### 1.4 Windsurf — `[Documented]` only (not installed)

Absence verified `[Observed]`: no `Program Files\Windsurf` or
`%LOCALAPPDATA%\Programs\Windsurf`; no installer downloaded. Sources fetched 2026-11-21:
`docs.devin.ai/desktop/cascade.md`, `.../devin-local/overview.md`, `.../quick-review.md`.
Note: `docs.windsurf.com/*` 307-redirects to `docs.devin.ai`; the product is now **Devin
Desktop** and Cascade is labelled **legacy** ("no longer starts new Cascade
conversations"). Current behavior follows the **Devin Local** agent, whose docs say an
edit "only runs after you approve it".

## 2. Qoder review flow — detailed findings `[Observed]`

### 2.1 Two review surfaces

1. **Per-turn inline summary card in the chat feed** `[Observed]`: `"File changes in
   this turn"`, `"Edited {{count}} files"`, `"Edited {{fileName}}"`, `"Undid changes to
   {{count}} files"`, collapsed with `"Show {{count}} more files"` / `"Show fewer
   files"`. Hovering a file gives a **quick diff preview**; the card carries a `"Review"`
   action (opens live review) and an `"Undo"` action.
2. **Workspace Review view** `[Observed]`: changed-files tree + diff editor —
   `"Change file tree"`, `"View diff for {{path}}"`, `"Jump to file…"`, `"Collapse all
   file changes"`, `"Expand all file changes"`, `"Show files"` / `"Hide files"`.

### 2.2 Change-source selector (the key idea)

The review view is parameterised by a **source**, not hard-wired to the agent
(`reviewSource` state: `"uncommitted"`, per-turn references, branch/commit bases):

- Labels: `"This turn"`, `"Last turn"`, `"All turns"`, `"Current task"`,
  `"Before changes"`, `"Current branch"`, `"Upstream branch"`, `"Commit"`,
  `"Select base"`, `"Select commit"`, `"Choose change source, currently {{source}}"`.
- Git sources share the same panel (`"No staged changes"`, `"No uncommitted changes"`,
  `"Unstaged, untracked, and conflicted files will appear here."`).
- `[Inferred]` One "what am I reviewing against?" control lets a single panel serve both
  "did the agent do what I asked?" and "what is pending for commit?".

### 2.3 Diff presentation

Renderer capabilities `[Observed]`: `diffStyle` (`"split"` / `"stacked"`), `hunks[]`
with `collapsedBefore` / `expandedHunks` / `collapsedContext`, `isPartial`, a
virtualised file diff (`VirtualizedFileDiff`) with layout checkpoints for
scroll/position mapping, and `fileAnnotationHeight`.

Strings: `"Stacked"`, `"Split"`, `"Show whitespace-only changes"`, `"{{count}}
unchanged lines"`, `"Change chunk"`, `"This diff is long, so only limited content is
shown."`, `"The binary file changed and cannot be shown as a text diff."`, `"The file
path changed without text content changes."`, `"File has merge conflicts"`, `"Refresh
changes"`, `"Open in Code"`, `"Deleted files cannot be opened in the workspace"`.

### 2.4 Undo / checkpoint semantics

- UI is **Undo**, not per-hunk accept/reject. Strings: `"Undo"`,
  `"Undo file changes from this turn onward?"`, `"This restores {{fileCount}} files and
  also undoes changes from {{turnCount}} affected turns. Task history will not be
  deleted."`, `"Checking which files and later turns will be affected…"`,
  `"File changes undone"`, `"Restored {{count}} files. Task history was kept."`,
  `"Cannot undo these changes"`, `"The file checkpoint is unavailable. The workspace
  was not changed."`.
- Failure is a workspace-state warning: `"Could not undo this turn"` / `"File
  restoration did not complete. Check the files in your workspace."`.
- After undo the turn stays visible: `"Undone"` / `"This turn's file changes were
  undone. Review still shows the original change record."`
- Partial honesty: `file-rewind-partial` and `local-rewind-sync-failed` map to distinct
  titles (`chatMessage.editPartialTitle`, `editLocalSyncFailedTitle`).
- `[Observed]` There is **no** per-hunk accept/reject. "accept" hits are unrelated
  (invitations, content filters, `scanRejected`). The agent writes straight to disk and
  offers turn-scoped undo.

### 2.5 State model (from renderer state shapes)

`[Observed]` Fields from model initialisers: `sessionId`, `turnReviewSessionId`,
`reviewSource`, `reviewReference`, `reviewLabel`, `reviewRewindState`,
`latestTurnChangeSetId`, `turnReviewSnapshot`, `gitStatus(es)`, `reviewStatus`,
`reviewTargets`, `reviewEditor(s)`, `reviewVisibleEditorId`, `reviewCollapsedFileIds`.

Per-turn grouping: `turnIndex[]` entries `{ turnId, messageId, summary, preview,
ordinal, timestamp }`; payloads carry `fileChangeSets[]`, `activeTurnFileChanges`,
`hasFileChangeReview`, `supportsSteer`, `supportsEditResend`. Change sets carry
`{ id, changeSetId, turnId, revision, rootId, path, status, unavailableReason,
completion, rewindState: "active"|"rewound", coverage: "partial", files[] }`;
rendering refreshes when `activeTurnFileChanges.revision` increases.

Order of operations: `previewTurnFileChangesUndo({sessionId, changeSetId})` then
`undoTurnFileChanges({sessionId, changeSetId})` — **preview before mutate**.

`[Inferred]` Baseline = per-turn file snapshot held by the agent service ("file
checkpoint"), not the Git index; review = `diff(baseline_turn, disk_now)`. Exact
storage (content store vs shadow worktree) is `[Unknown]` (`shadow` and `worktree`
both appear, in mixed contexts).

### 2.6 External-change / conflict handling (directly relevant to CodeTrail)

`[Observed]` Exact strings:
- `"Your edits differ from the file on disk. Using the disk version discards your
  edits; overwriting the disk replaces the external changes."` with buttons
  `"Use disk version"` / `"Overwrite with my edits"`, and
  `"Discard changes and reload"` / `"Unsaved edits will be discarded and the file will
  be reloaded from disk."`
- Save-state chip: `"Modified"`, `"Saving"`, `"Changed on disk"`, `"Save failed"`.
- Git revert is separately destructive: `"Tracked files return to the current commit,
  and new untracked files are deleted. This cannot be undone."`

### 2.7 Trust / privacy / scope indicators

`[Observed]` Attribution is deliberately weak: the artifact distinguishes
`"This turn" / "Last turn" / "All turns" / "Current task"` but never claims hunk-level
authorship. Privacy/scope surfaces: `settings.agentExecutionLocal`,
`settings.agentLocalStatus`, `settings.dataMode`, `settings.dataPolicyModePrivacy` /
`…ModeShare`, `settings.dataPolicyTeamManagedTip`, `settings.agentToolCatalogAlreadyAllowed/Denied`.
`[Inferred]` Qoder is cloud-connected (data-policy modes, org-managed tip); "local
execution" is an option, not the assumed default.

### 2.8 Limit states surfaced to the user (borrow this taxonomy)

`[Observed]`: `"This Diff record has expired and cannot be previewed."`, `"This Diff is
too large for the quick preview."`, `"No text Diff is available to preview."`, `"The
Diff could not be loaded. Move away and hover again to retry."`, `"The file changes for
this turn are temporarily unavailable."` — plus `diff_budget_exceeded`,
`quota_exceeded`, `file_too_large`, `binary_file` as distinct states.

## 3. Comparison matrix

Cells: ✅ present · ◐ partial/limited · ✗ absent · ? `[Unknown]`.
VS Code native = API/feature baseline as shipped `[Observed]`/`[Documented]`.

| Dimension | VS Code native | Qoder 0.4.11 | Cursor | Windsurf → Devin Desktop |
| --- | --- | --- | --- | --- |
| Inline diff | ◐ `vscode.diff` editors; no inline AI zone | ✅ split/stacked, per-hunk collapse+context, hover quick-preview card `[Observed]` | ✅ "Watch edits appear in the diff view as they happen" `[Documented]` | ◐ diff-based apply; Chat mode "may propose new code that you can accept and insert" `[Documented]` |
| File-level review | ◐ SCM file list is Git-only | ✅ changed-files tree + jump/filter + collapse/expand `[Observed]` | ✅ review in diff view, reject unwanted edits `[Documented]` | ✅ review changes in diff view; accept/reject per change (legacy regression reports exist, so current state `[Unknown]`) |
| Session grouping | ✗ (timeline = saves) | ✅ turn/message/task hierarchy with `turnIndex[]`, `fileChangeSets[]` `[Observed]` | ◐ chat thread + per-message checkpoints `[Documented]` | ◐ conversation + Todo list + named checkpoints `[Documented]` |
| Checkpoints / history | ◐ local timeline (saves only) | ✅ per-turn file checkpoint, `rewindState: active\|rewound`, partial-coverage flag `[Observed]` | ✅ auto-checkpoint before significant changes; stored locally, separate from Git `[Documented]` | ✅ named checkpoints + revert arrow per prompt; "Reverts are currently irreversible" `[Documented]` |
| Accept / reject | ✗ | ✗ (turn-level **Undo** only) `[Observed]` | ◐ review and reject in diff view; edit tools "apply them automatically" `[Documented]` | ◐ legacy Cascade per-change accept/reject; Devin Local: "an edit only runs after you approve it" `[Documented]` |
| Attribution | ✗ beyond Git author | ◐ turn/task scope only; no hunk authoring claim `[Observed]` | ◐ chat-thread scoped; AI code tracking is an enterprise analytics surface `[Documented]` | ◐ agent selector names the agent per conversation; `cascade_*` analytics `[Documented]` |
| Keyboard UX | ✅ native keybindings | ◐ ARIA "open live Review" action; exact keys `[Unknown]` | ✅ `Cmd/Ctrl+I` agent, `Shift+Tab` modes, `Enter`/`Cmd+Enter` queue, hover→Restore Checkpoint `[Documented]` | ◐ hover→revert arrow, TOC navigation `[Documented]`; shortcut keys `[Unknown]` |
| Privacy posture | ✅ fully local by construction | ◐ local-execution option + data-policy modes are configurable `[Observed]` | ◐ Privacy Mode = no training; prompts+context still sent to providers `[Documented]` | ◐ account login required; sandbox/network filtering configurable `[Documented]` |

Explicit unknowns: Cursor per-hunk accept/reject mechanics; Cursor checkpoint
on-disk format; Windsurf/DDS current accept-reject UX after the Cascade→Devin Local
migration; Qoder's snapshot storage backend; Qoder keybindings.

## 4. Answers to the research questions

**Q1 — How is live/reviewable change presented?** All four converge on *a diff view +
a changed-files list + a temporal anchor to undo back to*. Qoder is distinctive in
making **the turn** the primary grouping unit and putting a per-turn summary card in
the conversation. Windsurf's legacy flow was the most granular (per-change
accept/reject); its successor moved to approve-before-apply. Cursor applies edits
immediately and relies on checkpoint rollback `[Documented]`. VS Code alone offers no
AI notion at all.

**Q2 — What state model underlies review?** `[Inferred]` from `[Observed]` Qoder state
names, corroborated by Cursor/Windsurf docs:
`session → turn (turnId, ordinal, messageId) → change set (revision, rewindState,
coverage) → file entry (path, status, additions, deletions) → hunks (collapsedBefore,
expandedHunks, context)`, plus a **baseline snapshot** per turn and a **derived view
state** (`reviewSource`, `reviewReference`, `reviewCollapsedFileIds`, active editor id).
Cursor states checkpoints "save snapshots of your codebase"; Windsurf uses named
checkpoints over "the state of your codebase at the desired step" `[Documented]`.

**Q3 — How is trust preserved?** (a) *Preview before mutate*
(`previewTurnFileChangesUndo` precedes `undoTurnFileChanges`); (b) *honest partiality*
(`coverage: "partial"`, `file-rewind-partial`, "some line counts are unavailable");
(c) *history survives* ("Task history was kept", "Review still shows the original
change record"); (d) *explicit destructive language* for what is irreversible;
(e) *explicit external-change conflict wording* instead of silent overwrite;
(f) *scope chips* (this turn / last turn / all turns / current task); (g) *local vs
cloud data-mode settings*. Cursor adds Privacy Mode and states checkpoints are local
and separate from Git `[Documented]`.

**Q4 — Adoptable by a read-only observer?** See §5 and §6.

## 5. Design takeaways for CodeTrail (adoptable)

1. **Group the timeline into bursts, never call them "turns".** Neutral heading such as
   "Activity burst — 3 files, 12s". CodeTrail cannot know turn boundaries, so it must not
   borrow Qoder's "This turn" vocabulary.
2. **Per-file summary rows inside each card.** `path`, language, `+N/−N`, status
   (created/modified/deleted/renamed), and an explicit `partial` chip when counts are
   truncated — Qoder's `activeAriaLabelPartial` shows partiality must be spoken.
3. **Hunk expansion with configurable context.** Store `hunks[]` with
   `collapsedBefore`, `expandedHunks`, `contextLines` (default 3, per-file override).
   Already PROJECT.md F2; Qoder validates the exact shape.
4. **A change-source / scope selector** answering "changes since what?": session start,
   last save, selected timestamp, or all events. Adopt the pattern, not Git semantics.
5. **Hover/peek quick diff** with Qoder's state ladder: loading → loaded → expired →
   too-large → unavailable → binary. Never render an empty diff as "no changes".
6. **Focus-in-editor navigation:** open at first change, jump to next/previous change,
   reveal with a gutter/bead decoration, highlight the range; handle deleted files
   (`"Deleted files cannot be opened"`).
7. **Copy-only "Restore point" wording, no action.** Show a copyable/exportable
   timestamp and state plainly that CodeTrail will not revert anything.
8. **External-change messaging as a first-class event.** `FileSystemWatcher` events with
   no matching in-editor edit become "Changed outside VS Code", with the care of Qoder's
   disk-conflict copy. Label formatting-only and whitespace-only bursts separately.
9. **Honest attribution:** `source: "editor" | "external process" | "unknown"`; never a
   named agent. A shell-integration command may be shown as *correlated*, not authored.
10. **Session grouping** by time gap + shared document set + user rename; expose
    "This session / All history" named by time, not by agent vocabulary.
11. **Export the review record** as schema-versioned JSON and Markdown (per-file
    headings, fenced diff, +/− summary) — diffs can expire, exports do not.
12. **Failure states are UI states:** budget, truncation, binary and expired each get a
    distinct, calm message with CodeTrail's own visible limits.

## 6. Non-goals for CodeTrail (must stay out of scope)

1. **Accept / reject / keep-hunk.** Needs authority over the document buffer and a
   proposed-vs-applied model. CodeTrail sees only emitted edits; "reject" would be a
   second write racing the agent — Qoder's `local-rewind-sync-failed` failure class.
2. **Checkpoints / restore / rewind.** Needs snapshots the observer does not own.
   "Reverts are currently irreversible" (Windsurf) and "file checkpoint unavailable"
   (Qoder) are the failure modes a third party would inherit without the serializer.
3. **Agent identity or model attribution.** Qoder itself declines this; CodeTrail must
   not infer it from edit patterns.
4. **Turn/message identity** — depends on private chat protocols; use time + file
   overlap only.
5. **Inline diff inside the editor buffer** — requires injecting into another tool's
   diff surface; conflicts with the read-only posture. CodeTrail edits nothing.
6. **Auto-apply of any kind** (format, fix, merge, discard-and-reload).
7. **Remote/cloud review, share links, telemetry** — contradicts PROJECT.md F6.

## 7. Risks

1. **False attribution** — time grouping will occasionally split a turn. Mitigate with
   neutral labels and a "merged bursts" chip.
2. **Vocabulary drift** — Qoder strings are internal and change between builds; ship
   CodeTrail's own strings.
3. **Diff cost** — Qoder budgets diffs (`diff_budget_exceeded`); CodeTrail needs an
   explicit, visible budget, not silent truncation.
4. **Listener fatigue / race** — high-churn agents emit hundreds of edits per second.
   Debounce/coalescing must be tuned against real agent traffic.
5. **Over-trust in "Restore point"** — a timestamp may read as restorable. Label it
   "reference only" and point to the tool's own undo.
6. **Duplicate surfaces** — if the host editor ships its own changes panel, CodeTrail is
   redundant there. Edge: *cross-tool* and *local-only*; state that pitch plainly.
7. **Clean-room discipline** — implementation must be independent. This report quotes
   short user-facing strings as evidence only; no vendor code, layout assets or
   identifiers are to be reproduced.
8. **Documentation currency** — Windsurf is now Devin Desktop with Cascade legacy;
   Cursor docs moved hosts. Re-verify before making product claims.

## 8. Sources (all accessed 2026-11-21)

- Qoder 0.4.11 install + `app.asar`, local read-only analysis.
- REA `rea-agents@6.5.0` `analyze-javascript-application --integrity-policy record-and-continue`.
- Cursor: `cursor.com/docs/agent/overview`, `cursor.com/help/ai-features/agent`,
  `cursor.com/help/security-and-privacy/privacy`.
- Windsurf/Devin Desktop: `docs.devin.ai/desktop/cascade.md`,
  `docs.devin.ai/desktop/devin-local/overview.md`, `docs.devin.ai/desktop/quick-review.md`.

