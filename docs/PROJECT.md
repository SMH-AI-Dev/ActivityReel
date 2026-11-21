# ActivityReel — Project Specification

> This document replaces the former `ABOUT.md`. It preserves the original author/design
> details and turns them into an actionable, testable specification for version 1.

## 1. Identity

| Field | Value |
| --- | --- |
| Product name | **ActivityReel** |
| Extension ID (intended) | `smh-dev-ai.activityreel` |
| Publisher (intended) | `smh-dev-ai` |
| Language | TypeScript (extension host) + React/TypeScript (webview) |
| Minimum VS Code | `^1.93.0` (verified: first stable with terminal shell-integration events) |
| License | MIT |
| Repository | `https://github.com/SMH-AI-Dev/ActivityReel` (to be created) |

**Author:** Seyed Mehdi Hosseini (مهندس سید مهدی حسینی), Computer Software Engineer and AI specialist.
- Email: dev.smh.ai@gmail.com
- GitHub: https://github.com/SMH-AI-Dev/
- Hugging Face: https://huggingface.co/SMH-DEV-AI/

**Tagline:** *See every change in your workspace, live.*

## 2. Mission

ActivityReel gives VS Code users a beautiful, live, central view of what is happening in
their workspace: text edits with rich diffs, file creation/deletion/rename, saves,
tasks, debug sessions, and terminal commands (when shell integration is available).
It is an observer: it works with every editing tool and AI agent, requires no
integration, and keeps all data local.

## 3. Design principles (carried from the original AboutPage.tsx)

1. **Hero-first** — strong identity, mission statement, version badge, clear call to action.
2. **Orbit / bead motif** — circular motion and accent-colored beads that convey liveness.
3. **Animated counters** — ease-out cubic number animation for statistics.
4. **Card-based layout** — soft panels, chips, tags, section titles, staggered entrance animations.
5. **Theme-aware** — respects VS Code theme variables and accent colors, light/dark/high-contrast.
6. **Bilingual-friendly** — RTL/LTR support for English, Persian, and Arabic.
7. **Signature footer** — "Made with ♥" and links to the author's profiles.

Non-negotiable brand rules: no hard-coded colors that break themes, no layout that breaks
in RTL, no motion that ignores `prefers-reduced-motion`.

## 4. Feature pillars and acceptance criteria

### F1. Live change timeline
- Every text edit with at least one content change produces one collapsed timeline card
  (bursts within a short debounce window are merged per document).
- File create/delete/rename, save, task start/end, debug start/terminate, and terminal
  commands are shown as distinct event cards when tracking is enabled.
- Cards display relative time, workspace-relative file path, language, and +/− counts.
- New events appear without losing scroll position when the user has scrolled up;
  a "new activity" affordance jumps to the latest event.
- Clicking a card opens the file at the relevant line; the card can be expanded/collapsed.

### F2. Rich diffs
- Line-level diff with added/removed/context lines, line numbers, and collapsed hunks
  with configurable context (default 3 lines).
- Word-level intra-line highlighting for paired changed lines.
- Optional syntax-aware coloring that degrades gracefully for unknown languages.
- Large-file safety: diffs are truncated at a configurable limit and clearly marked.
- `+N / −N` counts are accurate for the recorded window.

### F3. Activity statistics
- Animated counters: events, files touched, lines added, lines removed, session duration.
- Counters use ease-out cubic and animate only when visible.
- A compact stats strip is visible without opening the full panel (status bar tooltip or sidebar).

### F4. Filters and search
- Filter by event type, file, time range (last 5m/1h/session), and free text.
- Filter state is preserved across panel hide/show and VS Code restarts (workspace-scoped).
- Search is case-insensitive and debounced; "no results" state is explicit.

### F5. Export and clear
- Export the current session as JSON and Markdown using the native save dialog.
- Clear history requires confirmation; clearing also resets statistics.
- Export includes settings metadata and schema version; no absolute user paths beyond
  workspace-relative paths (privacy default).

### F6. Privacy-first
- No telemetry, no network calls, no external uploads.
- Data is stored locally, scoped to the workspace, capped, and user-clearable.
- The extension declares no `network` capability; CSP in webviews denies remote content.

### F7. Reach and ergonomics
- Both an Activity Bar sidebar view and a full editor panel, sharing the same UI bundle.
- Status bar indicator with pause/resume.
- Commands: open panel, open sidebar, toggle pause, clear history, export JSON,
  export Markdown, show About.
- Keyboard shortcut for the panel (proposed: `Ctrl+Alt+L` / `Cmd+Alt+L`).
- Localization-ready strings with English and Persian (`fa`) message catalogs.

## 5. Non-goals for v1

- Editing code from the ActivityReel panel.
- Accepting/rejecting or reverting external edits (observer only).
- Cloud sync, accounts, or cross-window aggregation.
- Reliable attribution of changes to a specific AI agent or human (not exposed as fact).
- Full AST/tree-sitter structural diff (design for it, implement line+word diff first).

## 6. UX surfaces

| Surface | Purpose |
| --- | --- |
| Activity Bar sidebar (`activityreel.view`) | Always-available compact live feed |
| Editor panel (`activityreel.open`) | Full timeline, stats hero, filters, export |
| Status bar item | Liveness indicator, pause/resume, quick open |
| About page (webview) | Brand hero, version, author, privacy statement |
| Notifications | One-time first-run tip; errors only when actionable |

## 7. Technical contract

- **Architecture:** typed event bus → coalescing store → persistence → webview channel.
- **Diff:** Myers O(ND) line diff with prefix/suffix trimming, size guard, and a
  linear fallback for huge inputs; word-level refinement for adjacent replace pairs.
- **Events:** text edits, file CRUD/rename (API + FileSystemWatcher for external),
  saves, tasks, debug, terminal shell execution (version-gated).
- **Webview security:** strict CSP with nonce, `asWebviewUri`, no remote assets,
  HTML escaping for all user/document content, no `innerHTML` for untrusted strings.
- **Performance budgets:** event ingestion < 5 ms per burst (excluding diff), UI stays
  responsive with 1,000+ events via virtualization, initial webview render < 300 ms,
  bundle sizes documented.
- **Persistence:** workspace-scoped, versioned schema, capped events, corrupt-state recovery.
- **Testing:** unit tests for diff, store, filters, export; integration tests in the
  Extension Development Host for activation and core commands; manual F5 checklist.
- **Packaging:** esbuild for extension and webview, `vsce package`, `.vsix` artifact,
  128×128 PNG icon, README screenshots, CHANGELOG, LICENSE.

## 8. Definition of done (v1)

1. `npm run check` passes (typecheck + lint + unit tests).
2. Integration tests pass in the Extension Development Host.
3. Manual checklist passes in light, dark, and high-contrast themes, LTR and RTL.
4. `activityreel-<version>.vsix` builds reproducibly and installs cleanly.
5. No telemetry/network code paths; CSP verified.
6. README, CHANGELOG, LICENSE, icon, and Marketplace metadata complete.
7. Published to the VS Code Marketplace (requires publisher + PAT) or, if credentials
   are unavailable, every publish step is documented and verified up to `vsce publish`.

## 9. Marketplace facts gathered 2026-11-22

- The working name **CodeTrail** was dropped before the first publish: its exact display name
  is owned by `CodeTrail.codetrail` (published 2023-11-17), and the Marketplace requires
  display names to be globally unique.
- The final name is **ActivityReel**. API search for `activityreel` (filterType 10 + VS Code
  filter) returns **0 results**, so both the extension name and the display name are free
  (verified 2026-11-22).
- Exact ID `smh-dev-ai.activityreel` returns no results; the publisher page returns **404**
  because `smh-dev-ai` has not been registered yet and must be created by the author.
- Repository `SMH-AI-Dev/ActivityReel` is public and hosts release `v0.1.0` with the
  `activityreel-0.1.0.vsix` asset. Marketplace publication remains pending.
