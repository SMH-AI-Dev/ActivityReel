# CodeTrail — UI/UX Design Specification (v1)

Owner: UI/UX · Brand source of truth: `docs/PROJECT.md` §3.

---

## 1. Design intent

**Adjectives:** calm · precise · alive · native · legible.

"Live" must feel like a quiet heartbeat, not a siren. A single orbital mark rotates slowly (one full turn ≈ 9 s);
beads pulse only when a new event lands (≤ 2 pulses per event); counters ease to their new value once, on first
visibility. Everything else is still. Rules of restraint:

- One hero per surface. The editor panel's hero is the only place with gradient tint + orbit; the sidebar gets a 40 px
  strip version of the same motif so both surfaces feel like one product.
- Max **2 concurrent animations** on screen (orbit + one entrance). No parallax, no scroll-triggered motion.
- Color does one job per element: accent = "live / now", green/red = diff math, neutral = structure.
- If removing an element would not lose information or an action, remove it. Cards show one primary line, at most three
  metadata chips, and a diff when expanded.

---

## 2. Information architecture

Shared component tree; each surface renders a subset. Both surfaces are built from the same UI
bundle and read the same extension-side event store, but each webview has its own React state
hydrated over the message channel (webviews never share memory directly).

### 2.1 Activity Bar sidebar (`codetrail.view`, 300–500 px)

```
┌──────────────────────────────────────────────┐
│ ◉ CodeTrail            12  ⋯                  │  header (36px): OrbitMark 14px + title + count badge + overflow ⋯
├──────────────────────────────────────────────┤
│ ● Live · 3m 42s                              │  LiveBadge row (28px) — click toggles PausedState
├──────────────────────────────────────────────┤
│  +148   −37   9 files   12 ev   ⏱ 3:42       │  compact stat strip (two lines, 4 counters + duration)
├──────────────────────────────────────────────┤
│ [ All ][ Edit ][ Files ][ Tasks ][ Exec ]    │  FilterBar: scrollable type chips (overflow: x, mask fade)
│ [⌕ Search in changes…                     ]  │  SearchField (appears on focus of a search icon in narrow mode)
├──────────────────────────────────────────────┤
│ ▎src/diff.ts             +12 −3   2s   ▾     │  EventCard (collapsed, 64px) — click opens file (line target)
│   (expanded diff inside card, full width)    │
│ ▎package.json            +1  −1   14s  ▸     │
│ ▎<file created> docs/x.md         41s        │
│ ▎npm test          exit 0 · 1.2s   1m        │
│ ▎debug: launch      terminated    2m         │
│                                              │
│              ⋯ 120 more                      │  virtualized tail; no "load more" button
├──────────────────────────────────────────────┤
│  ⤓ New activity (7)  →                      │  NewActivityPill — fixed bottom, only when scrolled up
└──────────────────────────────────────────────┘
```

Narrow (300–340 px): stat strip shows 2×2 grid; FilterBar collapses to a single "Filters (2)" button opening a popover;
event cards hide the language chip and the hash.

### 2.2 Editor panel (`codetrail.open`, ≥ 720 px)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  ╭────────────────────────── hero (128px) ─────────────────────────╮                 │
│  │      ◌ orbit + beads (96px, inline SVG, CSS rotation)            │   CodeTrail     │
│  │  See every change in your workspace, live.   [{version}] [● Live] [⏸ Pause] [⋯]   │
│  ╰──────────────────────────────────────────────────────────────────╯                 │
│                                                                                      │
│  ┌── Stat card ──┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐  │
│  │ Events       │ │ Files touched│ │ Lines added  │ │ Lines removed│ │ Session    │  │
│  │  128   +4    │ │      23      │ │   +148       │ │    −37       │ │  3:42      │  │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘  │
│                                                                                      │
│  [ All ] [ Edits ] [ Files ] [ Tasks ] [ Debug ] [ Exec ] │ [Last 1h ▾] │ [⌕ Search…] │
│                                                                                      │
│  ── now ─────────────────────────────────────────────────────────────────────────────  │
│  ▎src/diff.ts                         TypeScript   +12 −3    2s ago            ▾      │
│  │  @@ -41,7 +41,9 @@ createLineDiff()                                            ▾  │
│  │   41   41   const lines = trim(prefix, suffix);                                   │
│  │  - 42        return fastPath(a, b);              ← removed                        │
│  │  + 42  +43  return guarded(myers(a, b), limit);  ← added (word marks below)       │
│  │  ⋯ 18 unchanged lines                        [Show all context]                   │
│  │  [Copy diff] [Copy path]                                                          │
│  ▎README.md            Markdown  +1 −1       14s ago                                  │
│  ▎npm test             exit 0 · 2.1s         1m ago                                   │
│              ⋯ 121 more                                     ⤓ New activity (3) →      │
│                                                                                      │
│  Made with ♥ by Seyed Mehdi Hosseini · GitHub · Hugging Face · MIT · ✦ privacy-first │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Breakpoints: ≥ 1100 px → 5 stat cards in a row; 720–1099 → 3 + 2 wrap; < 720 → horizontal scroll-snap stat row and
hero drops the tagline line (kept as `aria-describedby` text).

### 2.3 About page (`codetrail.about`)

Embeds the panel hero at 200 px (larger orbit, 128 px), mission paragraphs, privacy statement ("No telemetry, no network,
local only"), feature cards (reuse StatCard slot styling), keybindings table, author links, same Footer. No timeline.

---

## 3. Component inventory & states

Every interactive component: `default · hover · focus-visible · active · disabled` + states listed.

| Component | States | Notes |
| --- | --- | --- |
| **Hero** | idle · live · paused · degraded (event bus lagging) | 128 px. Background: `color-mix(in srgb, var(--vscode-focusBorder) 8%, var(--vscode-editor-background))`; 1 px `--vscode-panel-border`; radius 14. Degraded dims orbit to 40 % and shows "Catching up…". |
| **OrbitMark** | size sm(14) md(40) lg(96); live · paused · reduced | Pure inline SVG: 1 ring (`stroke: color-mix(focusBorder 45%, transparent)`), 3 beads (`--vscode-charts-blue/green/purple`, each with fallbacks), centre dot in `--vscode-foreground`. `role="img"`, `aria-label` from props. |
| **LiveBadge** | live · paused · stale (>60 s no events) · hc | Pill, `border-radius: 999px`, dot 6 px pulsing only in live. Stale uses `--vscode-descriptionForeground`. Text is a `<button>` in the panel (toggle pause), `<span>` in sidebar. |
| **StatCard** | idle · animating · updated(+N) · hover · focus(if actionable) | Label 11 px uppercase tracking .04em `descriptionForeground`; value 28 px/700 `--vscode-editor-font-family`, tabular-nums. Delta chip (`+4`) appears 1.2 s then fades. Border-left 2 px accent tint on `updated`. |
| **FilterBar** | default · chip selected · chip hover · focused · overflow | `role="group"` with `aria-label="Filter by event type"`; chips are `aria-pressed`. Selected chip: `color-mix(focusBorder 20%, transparent)` bg, `focusBorder` text. Time-range is a native `<select>` styled with `--vscode-dropdown-*`. |
| **SearchField** | empty · typing (debounce 180 ms) · results · no-results · error | `role="searchbox"`, inline clear button, `aria-describedby` result count. Match highlight uses `--vscode-list-highlightForeground`. |
| **EventCard** variants | edit · file-create · file-delete · file-rename · save · task · debug · terminal | Header grid `[rail 3px][icon 16][path 1fr][lang][+N −N][time][chevron]`. Rail color: edit `--vscode-gitDecoration-modifiedResourceForeground`; create `…addedResourceForeground`; delete `…deletedResourceForeground`; rename `…renamedResourceForeground`; save `--vscode-charts-blue`; task success `--vscode-charts-green` / fail `--vscode-charts-red`; debug `--vscode-charts-orange`; terminal `--vscode-charts-purple`. Always paired with an icon + type word in the a11y label (never color-only). |
| **EventCard** states | collapsed · expanded · hover · focus-visible · selected · new (slide-in) · merged ("+5 edits in 1 debounce") | Collapsed height 64 px (sidebar 56). Whole header is one `<button>`; inner actions (`Copy`, `Open`) are separate buttons using `stopPropagation`. |
| **DiffBlock** | collapsed · expanded · truncated · coarse-fallback · expired · hunk-collapsed · hc | See §6. |
| **EmptyState** | first-run · filtered-empty · cleared | Centered 96 px OrbitMark at 30 % opacity + one sentence + one action. First-run: "Keep this panel open while you or an agent edit files." + `Open docs` link; filtered-empty: `Clear filters` button; cleared: `Start over`. |
| **PausedState** | banner (in-flow) · pill (sidebar) | 40 px banner under hero: `background: color-mix(editorWarning.foreground 10%, transparent)`, text "Recording paused — changes are not tracked", `Resume` button. Timeline dims to 55 % and becomes read-only (cards still open files). |
| **NewActivityPill** | hidden · visible(n) · hover · focus | Fixed 12 px above footer, centered, `border-radius: 999px`, `--vscode-button-secondaryBackground`; text "{n} new {events}"; click scrolls to top and clears. |
| **Footer** | default · hover(link) | 1 px top `--vscode-panel-border`; "Made with ♥ by Seyed Mehdi Hosseini" + GitHub + Hugging Face + `MIT` + "local only". Heart is an SVG, `aria-hidden`; link labels stay explicit. |
| **AboutPage** | default | Composes Hero(lg), feature cards, privacy block, `Footer`. No motion beyond hero orbit. |

---

## 4. Visual tokens

All variables live in `styles/tokens.css`, consumed by CSS modules. VS Code exposes every theme color as
`--vscode-<id with dots → dashes>` and adds theme classes (`vscode-light`, `vscode-dark`, `vscode-high-contrast`, and
`vscode-reduce-motion`, `vscode-using-screen-reader`) to `<body>` ([Webview API](https://code.visualstudio.com/api/extension-guides/webview)).

### 4.1 Color mapping (source → token → usage)

| Token | VS Code variable (fallback) | Usage |
| --- | --- | --- |
| `--lp-bg` | `--vscode-editor-background` | Panel surface |
| `--lp-bg-elev` | `--vscode-sideBar-background` (fallback `--vscode-editor-background`) | Sidebar, card headers |
| `--lp-fg` | `--vscode-foreground` | Body text |
| `--lp-fg-muted` | `--vscode-descriptionForeground` (fallback `--vscode-foreground`) | Meta, timestamps, labels |
| `--lp-fg-disabled` | `--vscode-disabledForeground` | Paused timeline |
| `--lp-border` | `--vscode-panel-border` (fallback `--vscode-widget-border`) | Card borders, dividers — all elevation |
| `--lp-border-strong` | `--vscode-contrastBorder` (only set in HC) | HC 1 px outline on every card |
| `--lp-accent` | `--vscode-focusBorder` (fallback `--vscode-button-background`) | Focus rings, live dot, selected chip text, orbit ring |
| `--lp-accent-soft` | `color-mix(in srgb, var(--lp-accent) 14%, transparent)` | Selected chip, `updated` card tint |
| `--lp-btn-bg` | `--vscode-button-background` | Primary buttons |
| `--lp-btn-fg` | `--vscode-button-foreground` | Primary button text |
| `--lp-btn-hover` | `--vscode-button-hoverBackground` | Hover |
| `--lp-btn2-bg` | `--vscode-button-secondaryBackground` | Pill, Resume, Copy |
| `--lp-btn2-fg` | `--vscode-button-secondaryForeground` | |
| `--lp-btn2-hover` | `--vscode-button-secondaryHoverBackground` | |
| `--lp-input-bg` | `--vscode-input-background` | SearchField |
| `--lp-input-fg` | `--vscode-input-foreground` | |
| `--lp-placeholder` | `--vscode-input-placeholderForeground` | |
| `--lp-badge-bg` / `--lp-badge-fg` | `--vscode-badge-background` / `--vscode-badge-foreground` | Count chips |
| `--lp-hover-bg` | `--vscode-list-hoverBackground` | Card hover |
| `--lp-sel-bg` | `--vscode-list-activeSelectionBackground` / `--vscode-list-inactiveSelectionBackground` | Selected card |
| `--lp-add` | `--vscode-gitDecoration-addedResourceForeground` | `+N`, added rail, added text |
| `--lp-del` | `--vscode-gitDecoration-deletedResourceForeground` | `−N`, removed rail |
| `--lp-mod` | `--vscode-gitDecoration-modifiedResourceForeground` | Edit rail |
| `--lp-ren` | `--vscode-gitDecoration-renamedResourceForeground` | Rename rail |
| `--lp-chart-{blue,green,orange,purple,red,yellow}` | `--vscode-charts-*` | Beads, save/task/debug/terminal rails |
| `--lp-warn` | `--vscode-editorWarning-foreground` | Paused banner text |
| `--lp-link` | `--vscode-textLink-foreground` / `-activeForeground` | Footer links |
| `--lp-diff-add-bg` | `--vscode-diffEditor-insertedLineBackground` (fallback `color-mix(in srgb, var(--lp-add) 14%, transparent)`) | Added line bg |
| `--lp-diff-del-bg` | `--vscode-diffEditor-removedLineBackground` (fallback `…var(--lp-del) 14%…`) | Removed line bg |
| `--lp-diff-add-text` | `--vscode-diffEditor-insertedTextBackground` (fallback `…var(--lp-add) 28%…`) | Word-level mark |
| `--lp-diff-del-text` | `--vscode-diffEditor-removedTextBackground` (fallback `…var(--lp-del) 28%…`) | |
| `--lp-diff-hunk` | `color-mix(in srgb, var(--lp-accent) 8%, transparent)` | Hunk header |

Rules: never inline a hex brand color; the only literals allowed are inside `fallback` arguments, and they must be used
only when the VS Code var is absent (bare themes). `color-mix` requires a resolved color, so always wrap the theme var in
`var(--vscode-x, <fallback>)` when mixing.

**High contrast fallbacks** — under `body.vscode-high-contrast, body.vscode-high-contrast-light`:
tints collapse to `transparent`; added/removed use 2 px solid left border in `--lp-add`/`--lp-del` plus a `+`/`−` glyph;
word marks become `text-decoration: underline` with `text-decoration-color` from the same token (plus a dotted
`outline-offset` variant for HC-light); focus/selection uses `--vscode-contrastActiveBorder`; orbit beads get
`stroke: --lp-fg` so they never vanish; all decorative gradients are removed.

### 4.2 Spacing, radii, elevation

- Space scale: `--lp-s1:4px; --lp-s2:8px; --lp-s3:12px; --lp-s4:16px; --lp-s5:24px; --lp-s6:32px`. Nothing else.
- Radii: `--lp-r-sm:6px` (chips, buttons), `--lp-r-md:10px` (cards, inputs), `--lp-r-lg:14px` (hero, panel header).
- Elevation: **borders, not shadows**. Cards: `1px solid var(--lp-border)` on `--lp-bg-elev`. Overlays (popover,
  dropdown): `1px solid --lp-border` + `0 4px 16px var(--vscode-widget-shadow, color-mix(in srgb, #000 24%, transparent))`.
  The only shadow allowed beyond overlays is the NewActivityPill.
- Grid: 12-col content grid, max content width 1200 px centered, gutters 24 px; timeline full-bleed inside max width.

### 4.3 Typography

| Role | Font | Size / line-height | Weight |
| --- | --- | --- | --- |
| Page title (hero) | `var(--vscode-font-family)` | 22 px / 1.25 | 650 |
| Section title | font-family | 13 px / 1.4, `letter-spacing .02em` | 600 |
| Body | font-family | 13 px / 1.55 | 400 |
| Meta / label | font-family | 11 px / 1.4, `letter-spacing .04em` | 500 |
| Stat value | `var(--vscode-editor-font-family)` | 28 px / 1.1, `font-variant-numeric: tabular-nums` | 700 |
| File path | `var(--vscode-editor-font-family)` | 12 px / 1.4 | 500 |
| Diff / code | `var(--vscode-editor-font-family)` | `var(--vscode-editor-font-size, 12px)` / 20 px | `--vscode-editor-font-weight` |

Never import web fonts; VS Code's font variables already encode user preference. Sidebar scales one step down
(title 15 px, body 12 px, stat value 17 px).

### 4.4 Accent strategy

The accent is whatever the user's theme says: `--vscode-focusBorder` for interactive emphasis, button vars for actions,
`gitDecoration-*` for diff semantics. Product "brand" is expressed through **shape and motion** (orbit, bead, radius),
not hue. This guarantees zero clash with One Dark Pro, Solarized, Nord, or a corporate theme, and satisfies PROJECT.md's
"no hard-coded colors" rule. Charts vars are used only for multi-hue decorations where a theme intentionally supplies a
palette; in single-hue themes they resolve to the theme's chart color and beads differentiate by size/opacity, not hue.

---

## 5. Motion

| Animation | Spec | Trigger |
| --- | --- | --- |
| Entrance stagger | `translateY(6px)` + fade 0→1, 220 ms `cubic-bezier(.2,.7,.3,1)`, delay `index × 40 ms` (cap at 8 items → max 320 ms) | First paint of cards/stat cards |
| Orbit rotation | 9 s linear infinite; `transform: rotate()` on a `<g>`; paused state → 60 s; hc → static | Live |
| Bead pulse | 1.6 s, `scale 1 → 1.35 → 1`, opacity 1 → .55 → 1; max 2 iterations | New event |
| Counter | 700 ms `ease-out-cubic` (t → 1−(1−t)³), from previous value to target; starts once in view via `IntersectionObserver` | Value change while visible |
| New event slide-in | `translateY(-8px) scale(.985)` + fade, 260 ms; if scrolled up, no layout shift (pill instead) | New event |
| Card expand | height auto via `grid-template-rows: 0fr → 1fr`, 200 ms; chevron rotates 180° | User |
| Hover | background/color only, 120 ms linear | Pointer |

Kill switch: `@media (prefers-reduced-motion: reduce)` **and** `body.vscode-reduce-motion` → all durations `1ms`,
orbit static, pulses off, counters jump to final value, slide-ins become instant. Scroll is never animated; no
`scroll-behavior: smooth` (use instant jump for NewActivityPill so it is deterministic). Animations use `transform`/
`opacity` only; `will-change` on the orbit `<g>` only while live.

---

## 6. Diff design

```
  @@ -41,7 +41,9 @@ createLineDiff()                                   [Collapse ▾]
  40   40   const ctx = lines.slice(0, 0);
  41   41   const [p, s] = trim(prefix, suffix);
- 42        return fastPath(a, b);
+ 42   42   return guarded(myers(a, b), limit);
+      43   // guard: linear fallback
  ⋯ 18 unchanged lines                                          [Show all context]
  ── truncated: showing first 500 of 2,341 changed lines ──      [Copy full diff]
```

- **Gutter:** two 44 px line-number columns (old | new) in `--vscode-editorLineNumber-foreground`, `user-select: none`,
  `aria-hidden`; a 16 px column holds `+` / `−` / space.
- **Line rows:** 20 px line-height; added `--lp-diff-add-bg` + 2 px inline-start border `--lp-add`; removed mirror; context none.
  Borders sit on an inset pseudo-element so they never shift layout.
- **Word-level marks:** `<mark>` with `--lp-diff-add-text` bg, radius 2 px, only on paired replace lines. Text color never
  changes (only bg), so contrast never degrades; HC swaps to underline (§4.1); never the sole signal (counts also shown).
- **Hunks:** 24 px header, mono 11 px, `--lp-diff-hunk` bg, chevron with `aria-expanded`; context groups > 8 lines collapse to
  "⋯ N unchanged lines · Show all context" (no re-diff).
- **Truncation:** at the configured limit (default 500, `MAX_DIFF_LINES`) insert a terminal notice row with exact counts
  ("showing first 500 of 2,341 changed lines") and a "Diff truncated" chip; copy copies the visible unified portion.
  The host never stores the untruncated payload, so no misleading "Copy full diff" affordance.
- **Coarse fallback:** when the diff engine hits its time/edit-distance guard, show "Large change — summarized" with
  stats and the trimmed before/after block; no fake per-line accuracy.
- **Diff expired:** events older than the retained-diff window (newest 300) render stats + "Diff no longer retained";
  the header actions `Open` and `Copy summary` remain available.
- **Copy:** copies unified-diff text through the extension host (`vscode.env.clipboard.writeText` via the
  `copy` message; `navigator.clipboard` only as a fallback); no toast — button label swaps to "Copied" for
  1.5 s in the polite live region.
- **Direction:** `dir="ltr"`, `text-align: left`, `unicode-bidi: isolate` on the line grid; paths follow document direction.
- **Screen reader:** hidden summary per block: "Diff for src/diff.ts: 12 lines added, 3 removed, 2 hunks, changes at lines 42
  to 44"; hunk headers are `role="heading" aria-level="4"`.

---

## 7. RTL

- Set `<html dir>` and `lang` from extension (`vscode.env.language` / configured locale); Persian (`fa`/`ar`) → `rtl`.
- **Logical properties only:** `margin-inline`, `padding-inline`, `inset-inline-start`, `border-inline-start`,
  `text-align: start`. No `left/right`, no `float`. Grid uses `grid-template-columns: 3px 16px 1fr auto` which mirrors
  automatically; chevrons and "open" arrows use `scaleX(-1)` under `[dir="rtl"]` (one selector, one icon flag).
- **Orbit:** `rotate(0 → 360deg)` keyframes; under RTL `animation-duration/direction` reverses so beads travel the other way.
- **Numbers and time:** `Intl.NumberFormat` + `Intl.RelativeTimeFormat(locale, {numeric:'auto'})` ("3 minutes ago" /
  "۳ دقیقه پیش"); diff counts render `+148 −37` with `dir="ltr"` + isolate so signs stay correct.
- **Mixed content:** file paths, hashes, SHAs, branch names, commands, and all code get `dir="ltr"` and
  `unicode-bidi: isolate`; their containers keep `text-align: start` and `overflow-wrap: anywhere`.
- Test matrix adds fa-RTL × light/dark/HC.

---

## 8. Accessibility

- **Keyboard:** roving tabindex over EventCard headers (↑/↓, Home/End); Enter/Space toggles expand when focus is on the
  header, Enter on the "open file" zone opens document+line; `⌥/Alt+↓` inside a card moves into the diff controls. Tab
  order = visual order. Esc closes popovers and returns focus to the trigger. Focus is never trapped.
- **Focus-visible:** `outline: 2px solid var(--lp-accent); outline-offset: 2px`; never `outline: none`; HC uses `contrastActiveBorder`.
- **aria-live:** one visually hidden `aria-live="polite" aria-atomic="true"` region; **coalesced** to max one per 5 s
  ("3 new changes, latest: src/diff.ts"); silent when paused; pause/filter changes announce immediately.
- **Icon buttons:** `aria-label` required ("Copy diff", "Pause live tracking"); icon SVGs `aria-hidden focusable="false"`.
- **Contrast:** text ≥ 4.5:1 (muted meta falls back to `color-mix(fg 75%, bg)` if `descriptionForeground` fails), large text
  and UI ≥ 3:1, HC text ≥ 7:1.
- **Structure:** landmarks (`header/main/footer`), one `h1` per surface, ordered headings; filters are `aria-pressed` toggles;
  feed is `role="feed"` of `article`s with `aria-posinset`/`aria-setsize`.
- **Diffs:** summary sentence per block (§6), hunks expandable via keyboard, word marks not the sole signal.
- Every rail color is paired with an icon and word in the accessible name (never color-only).

---

## 9. Performance

- **Virtualization:** fixed 64 px row estimate (56 sidebar), overscan 6, cached measured heights; expanding re-measures one
  card; ≤ 40 mounted cards with 1,000+ events (PROJECT.md §7).
- **Skeletons:** 3 static-tint card skeletons until `history` arrives (no shimmer under reduced motion); render < 300 ms.
- **Memoization:** `React.memo` EventCard keyed `(id, revision, isExpanded, selected)`; `useMemo` selectors; counters isolated
  so stat updates never re-render the feed; split `state`/`dispatch` contexts.
- **DOM per card:** collapsed ≤ 12 nodes; expanded diff ≤ 200 line rows, chunked +100 per idle callback.
- **Image-free:** zero raster assets; OrbitMark, icons, heart and chevrons are inline SVG or codicons; no remote requests.
- **Scroll:** passive listeners, one rAF-throttled handler, no scroll-linked animation, one rAF loop for counters.
- Budgets: JS ≤ 120 KB gzip, CSS ≤ 20 KB gzip, no layout thrash, < 1 % CPU at idle.

---

## 10. Implementation notes (React + TS webview)

- React 19 + TS, Vite/esbuild → one bundle per surface (shared chunk), CSS Modules + global `tokens.css`.
  No general UI library; a small virtualization primitive (e.g. `@tanstack/react-virtual`) is allowed.
- Layout: `webview/src/{surfaces/{Sidebar,Panel,About},components/,styles/tokens.css,hooks/,store/,i18n/}`. Surfaces read `window.__CODETRAIL__ = { surface: 'panel' | 'sidebar' | 'about' }` injected at bootstrap.
- Component contract: every component gets `data-testid`, forwarded `ref`, and no implicit colors in TS — colors only via
  classes/tokens. Diff text is always rendered as text nodes (no `innerHTML`); copy posts a `copy` message to the
  extension host, which writes through `vscode.env.clipboard`.
- State: single store; messages `history | patch | state | theme` from extension; webview posts `ready | pause | resume |
  openDocument{uri,line} | copy | export | clear`. Persist scroll + filters via `vscode.setState` (not
  `retainContextWhenHidden`).
- Direction: `<html dir>` set by the extension; `i18n/{en,fa}.json` bundled with placeholders, never concatenated sentences.
- Reduced motion: `useReducedMotion()` watching both media query and `body.vscode-reduce-motion`; counters/pulses read it.
- Tokens: `tokens.css` holds only the §4.1 mapping + scales; `color-mix` in sRGB.

---

## 11. Acceptance checklist (strict reviewer)

1. [ ] Every color in the UI resolves to a `--vscode-*` variable or a `color-mix` of one; `grep -r "#[0-9a-f]\{3,8\}"` in
       `webview/src` returns only documented fallbacks.
2. [ ] Hero + OrbitMark present on both surfaces (lg / sm), version badge and pause control visible without scrolling.
3. [ ] Counters animate ease-out-cubic ≈ 700 ms once, only when visible; stat strip exists in sidebar without opening panel.
4. [ ] Diff shows line numbers, +/− gutters, word marks, collapsible hunks (default 3 context), truncation notice with
       counts, and copy action; identical behavior ≤ 200 px width.
5. [ ] Theme matrix passes: Default Light, Dark, Dark High Contrast, Light High Contrast × LTR + fa-RTL; zero contrast
       failures; no hard-coded blue anywhere.
6. [ ] `prefers-reduced-motion` and `body.vscode-reduce-motion` both freeze orbit/pulses/slide-ins; nothing animates on
       scroll.
7. [ ] RTL: layout mirrors with logical properties, orbit reverses, code blocks stay LTR (`dir="ltr"`), times/numbers are
       localized.
8. [ ] Keyboard-only run: reach every control, visible focus ring, Esc closes popovers, roving tabindex in feed works;
       screen reader announces coalesced new activity and a diff summary.
9. [ ] 1,000 events: ≤ 40 mounted cards, no scroll jank, skeleton on first paint, NewActivityPill preserves scroll
       position, zero raster images and zero network requests.
10. [ ] Signature footer present (heart + author links + license + privacy note), About page reaches brand hero, and the
        whole UI reads as VS Code-native — not a dashboard skin.

---

### Sources

- VS Code Theme Color reference (color IDs used above): https://code.visualstudio.com/api/references/theme-color
- VS Code Webview API (CSS variables `--vscode-*`, font variables, `vscode-light/dark/high-contrast`):
  https://code.visualstudio.com/api/extension-guides/webview
- `vscode-reduce-motion` and `vscode-using-screen-reader` body classes verified in the installed
  webview bootstrap: `...\resources\app\out\vs\workbench\contrib\webview\browser\pre\index.html`
  (lines ~507–523), 2026-11-21.
- Brand principles and feature requirements: `docs/PROJECT.md` §3, §4
