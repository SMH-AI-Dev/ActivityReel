# CodeTrail — Marketplace Identity and Initial Release Prerequisites

> **Status:** planning / prerequisites only. **Nothing was published.** No extension source code
> was modified. All verification below was performed on **2026-11-21** (UTC) from this machine.
> All account, publisher, and credential creation must be done by the author; an agent cannot
> create accounts or accept legal terms.

| Field | Value |
| --- | --- |
| Intended extension ID | `smh-dev-ai.codetrail` |
| Publisher ID (intended) | `smh-dev-ai` |
| Local project | `E:\SMH\LivePatch` (folder name predates the CodeTrail rename; git repo: `SMH-AI-Dev/CodeTrail`) |
| Verification date | 2026-11-21 |
| Source of truth for product scope | `docs/PROJECT.md` |

## 0. Supervisor decisions (2026-11-21)

These override the generic recommendations below where they conflict with the product's purpose:

1. **Keep `onStartupFinished`.** Live tracking from window start is a core product feature
   (the user asked to see *everything* happening in VS Code, including changes made before the
   panel is opened). `activate()` must stay lightweight: register listeners, create no webview,
   and do nothing when `codetrail.enabled` is false. Remove redundant `onCommand:*`/`onView:*`
   entries (implicit since 1.74) but keep `onStartupFinished` (and `onWebviewPanel` for restore).
2. **Categories:** ship `["Other", "Visualization"]`. Both are valid and honest; `Visualization`
   is the closest fit for a live visual timeline. `SCM Providers` is not used in v1.
3. **Version:** first public release is `0.1.0`, not `0.0.1`.
4. **Repository:** the intended URL is `https://github.com/SMH-AI-Dev/CodeTrail`. The author must
   create the public repo before publishing so README-relative images and Resources links resolve.
5. **Publishing:** accounts/PAT/legal acceptance remain with the author; the agent prepares and
   verifies everything up to `vsce publish`.

---

## 1. Verified name status (with evidence)

### Method

```
POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery
Headers: Content-Type: application/json
         Accept: application/json;api-version=7.2-preview.1
         User-Agent: Mozilla/5.0
Body (name search, filterType 10):
{"filters":[{"criteria":[{"filterType":10,"value":"codetrail"}],
 "pageNumber":1,"pageSize":50,"sortBy":0,"sortOrder":0}],"assetTypes":[],"flags":914}
Body (exact ID, filterType 7):
{"filters":[{"criteria":[{"filterType":7,"value":"smh-dev-ai.codetrail"}],
 "pageNumber":1,"pageSize":50,"sortBy":0,"sortOrder":0}],"assetTypes":[],"flags":914}
```

`filterType 10` = search text (matches name / displayName / description / keywords).
`filterType 7` = exact extension ID (`publisher.name`). `flags 914` = include versions, files,
statistics and latest version metadata.

### Results (2026-11-22, after the rename)

| # | Probe | Result |
| --- | --- | --- |
| 1 | API search `codetrail` (filterType 10 + VS Code filter) | **Conflict found:** `CodeTrail.codetrail` with displayName **CodeTrail** (published 2023-11-17, 63 installs, 352 downloads). Other unrelated ids: `codetrail-graph`, `codetrail-app`, `code-trail`. |
| 2 | API exact ID `smh-dev-ai.codetrail` (filterType 7) | **0 results** — the ID is free. |
| 3 | Publisher page `https://marketplace.visualstudio.com/publishers/smh-dev-ai` | **404** — publisher not registered. |
| 4 | Display name `CodeTrail Live` | No extension in the search results uses this display name. Presumed free; uniqueness is enforced at publish time. |
| 5 | Positive controls (earlier run) | `python` and `ms-python.python` returned real results, so zero/one-result queries above are meaningful. |

### Interpretation

- **Extension name `codetrail`:** already used by other publishers, but an extension ID is
  `publisher.name`, so `smh-dev-ai.codetrail` remains free. The official manifest page's
  "name must be unique" wording is publisher-scoped in practice.
- **`displayName` must be unique Marketplace-wide** (official manifest docs, quoted below).
  **`CodeTrail` is taken**, so the shipped display name is **`CodeTrail Live`**.
- **Publisher `smh-dev-ai`:** does not exist yet (404). The author must create it (see §5).
- **Caveat:** Marketplace search is not a reservation system. Absolute uniqueness is only
  enforced at publish time.
- Official rule (manifest reference): "The display name must be unique to the Marketplace."

---

## 2. Metadata proposal

### 2.1 Proposed `package.json` fields (review only — source not modified)

```jsonc
{
  "name": "codetrail",                     // lowercase, no spaces (correct today)
  "displayName": "CodeTrail Live",         // "CodeTrail" is taken; displayName is Marketplace-unique
  "description": "See every change in your workspace, live: diffs, saves, tasks and terminal commands. Local, private.", // 100 chars
  "publisher": "smh-dev-ai",
  "version": "0.1.0",                      // see §6 on 0.0.1 vs 0.1.0
  "license": "MIT",
  "engines": { "vscode": "^1.93.0" },      // see 2.4
  "categories": ["Other", "Visualization"],
  "keywords": [ /* 29 items, §3.2 */ ],
  "icon": "images/icon.png",               // PNG, 128x128 min; supply 256x256 (§4)
  "galleryBanner": { "color": "#0B1020", "theme": "dark" },
  "pricing": "Free",
  "repository": { "type": "git", "url": "https://github.com/SMH-AI-Dev/CodeTrail.git" },
  "bugs": { "url": "https://github.com/SMH-AI-Dev/CodeTrail/issues" },
  "homepage": "https://github.com/SMH-AI-Dev/CodeTrail#readme",
  "qna": "marketplace",
  "activationEvents": ["onStartupFinished", "onWebviewPanel:codetrail.panel"],
  "capabilities": {
    "untrustedWorkspaces": { "supported": true },
    "virtualWorkspaces": true
  },
  "main": "./dist/extension.js"
}
```

**Description length:** measured at exactly **100 characters** (`node` `.length`):
`See every change in your workspace, live: diffs, saves, tasks and terminal commands. Local, private.`
The Marketplace UI truncates long descriptions in search results; keeping it ≤100 chars is the
practical target the brief asks for.

### 2.2 Why these categories

Current `"categories": ["Other"]` is valid but unchallenging. The official allowed list is fixed
(§3.1). CodeTrail is an activity/diff observer, so:

- **`Other`** — required honestly; there is no "Productivity" or "AI" category in the official list.
- **`Visualization`** — valid and accurate: the extension's primary output is a live visual timeline
  and diff viewer. It is not a source-control provider, so **do not use `SCM Providers`** in v1.
  Final v1 choice per §0: **`["Other", "Visualization"]`**.

### 2.3 Repository / bugs / homepage

- `repository.url` must point at the **public** GitHub repo
  `https://github.com/SMH-AI-Dev/CodeTrail` (per `PROJECT.md`: "to be created"). The repo **must
  exist and be public before packaging**, because:
  1. `vsce` rewrites relative README links against `repository` when packaging, and
  2. the Marketplace **Resources** panel will show dead links otherwise.
- `bugs.url` → `https://github.com/SMH-AI-Dev/CodeTrail/issues` (enable Issues on the repo).
- `homepage` → repo `#readme` (Marketplace shows it under Resources → Homepage).
- Do **not** ship a `repository` field pointing to a private repo; `vsce` will still publish but
  README images/links will break.

### 2.4 `engines.vscode` recommendation

| Option | Rationale |
| --- | --- |
| `^1.90.0` | Feasible but forces runtime feature gates for terminal APIs and `TextDocumentChangeReason`. |
| **`^1.93.0` (locked)** | First stable with terminal shell-integration events; verified 2026-11-21. Zero gates; still broad reach. |
| `^1.99.0` | Only needed if you use `--target` multi-platform publishing (§4.2); not needed for a pure-JS/TS extension. |

**Rule:** `engines.vscode` must be **≤ the installed `@types/vscode` minor** (vsce warns when the
manifest claims a newer API surface than the types). If you raise `engines` to `^1.93.0`, raise
`@types/vscode` to `^1.93.0` in the same change. `engines.vscode` may never be `*`.

### 2.5 Activation events — product-specific decision

Current manifest has:

```json
"activationEvents": ["onStartupFinished", "onCommand:codetrail.open"]
```

Generic best practice (VS Code docs) is to avoid startup activation. **CodeTrail deliberately
deviates**, because seeing *every* change from window start is the product:

1. **Keep `onStartupFinished`.** Tracking that only begins when the panel is opened would miss
   exactly the edits the product exists to capture, and the status bar could not reflect liveness.
   Keep `activate()` cheap: no webview creation, no diff work until an event arrives, and an early
   return when `codetrail.enabled` is false.
2. **Drop the explicit `onCommand:*` / `onView:*` entries.** Since **VS Code 1.74.0**, commands and
   views activate implicitly; the declarations are redundant.
3. Keep `onWebviewPanel:codetrail.panel` (if a serializer is registered) so a restored panel can
   rehydrate; this is separate from startup tracking and is not declared statically in all
   versions — verify with the chosen `engines.vscode`.
4. Final v1: `"activationEvents": ["onStartupFinished"]` plus any serializer event required by the
   installed VS Code version. Document the tradeoff in the README privacy section.
5. If you later support a dedicated URI handler, add **only** `onUri`.

Official note (activation events reference, fetched 2026-11-21):
> "Beginning with VS Code 1.74.0, commands contributed by your extension do not require a
> corresponding `onCommand` activation event declaration…"
> "Beginning with VS Code 1.74.0, views contributed by your extension do not require a
> corresponding `onView` activation event declaration…"

### 2.6 Marketplace listing outline

Structure the `README.md` in this order (it *is* the listing body):

1. **Hero block** (≤ 12 lines)
   - H1: `CodeTrail — see every change in your workspace, live`
   - One-sentence mission; badge row (VS Code version, Marketplace version, License MIT, Installs).
   - Primary screenshot (`docs/marketplace/assets/01-hero-dark.png`).
2. **What it does** — 4–6 bullet outcomes (live timeline, rich diffs, stats, filters, export,
   privacy). No jargon about internals.
3. **Works with everything** — explicit: "Observes VS Code APIs only. No integration with, or
   dependency on, any AI agent or extension. Attribution is never asserted."
4. **Feature tour** — one subsection per pillar F1–F5 from `PROJECT.md`, each with a screenshot
   and a 2-line caption.
5. **Privacy** — copy the F6 guarantees: no telemetry, no network calls, no uploads, workspace-local
   storage, user-clearable, CSP denies remote content.
6. **Getting started** — install, open sidebar, open panel, default keybinding, first-run tip.
7. **Commands & keybindings** — table of contributed commands and defaults.
8. **Settings** — table of contributed settings with defaults and ranges.
9. **Light / dark / high-contrast + RTL** — a single strip screenshot proving theme and RTL safety
   (a differentiator, and a `PROJECT.md` brand rule).
10. **Limitations & non-goals (v1)** — pointer to `PROJECT.md` §5 content, honestly worded.
11. **FAQ** — "Is my code sent anywhere?" (No.) "Does it work with Cursor/Windsurf/remote?" (Yes —
    standard APIs; no agent dependency.)
12. **Support / License / Changelog** — link `SUPPORT.md`, `LICENSE`, `CHANGELOG.md`.

---

## 3. Valid categories and keywords

### 3.1 Categories — the complete, exact allowed list

From the official Extension Manifest reference (2026-11-21). **Only these 17 strings are valid:**

```
Programming Languages   Snippets     Linters    Themes      Debuggers
Formatters              Keymaps      SCM Providers          Other
Extension Packs         Language Packs          Data Science
Machine Learning        Visualization           Notebooks
Education               Testing
```

Notes:
- There is **no** `AI`, `Productivity`, `Editor`, or `Diff` category. Do not invent one; `vsce`
  rejects unknown values.
- `Language Packs` is reserved for display-language extensions (not applicable to CodeTrail, even
  though it ships `fa` message catalogs).
- `Programming Languages`, `Snippets`, `Linters`, `Themes`, `Debuggers`, `Formatters`, `Keymaps`
  do not describe CodeTrail.

### 3.2 Keywords — 29/30 proposed (hard cap = 30)

The Marketplace rejects packages with more than 30: *"You exceeded the number of allowed tags of 30"*.
Both the manifest reference and the publishing FAQ state the limit of 30.

```
diff, live-diff, workspace-changes, change-timeline, timeline, activity,
file-watcher, review, git, history, session, observability,
ai, agent, copilot, claude, cursor,
productivity, developer-tools, editor,
local-first, privacy, no-telemetry,
export, markdown, webview, status-bar, persian, rtl
```

Count: **29** (1 slot spare). Keep them lowercase; avoid duplicates, since each one is a
ranking signal and a tag chip users see. Do not stuff keywords that the description already
guarantees (e.g. do not repeat "vscode" — it is implicit).

---

## 4. Assets checklist

Everything here is **missing from the workspace today** except `.vscodeignore`. Confirmed by
listing `E:\SMH\CodeTrail`: no `LICENSE`, no `CHANGELOG.md`, no `images/` or icon file.

### 4.1 Required files

| Asset | Requirement (official) | Status | Notes |
| --- | --- | --- | --- |
| `README.md` | Delivered as the Marketplace body; relative image links allowed with `repository` set | Exists, **prototype-quality** (says "not published to the Marketplace" — must be rewritten) | Replace before packaging. |
| `LICENSE` | Recommended; `license: "MIT"` matches if an MIT LICENSE file is present | **Missing** | Add MIT text with `Copyright (c) 2026 Seyed Mehdi Hosseini`. |
| `CHANGELOG.md` | Recommended; surfaced in the listing | **Missing** | Start at `0.1.0`. |
| `SUPPORT.md` | Recommended | **Missing** | Link issues + email. |
| `images/icon.png` | **PNG**, **at least 128×128** ("256×256 for Retina screens"); **SVG is rejected** | **Missing** | Ship 256×256 PNG, square, no transparency-dependency, legible at 32 px. |
| `.vscodeignore` | Excludes dev files | Exists | See 4.4. |
| `galleryBanner` | Optional; contrasting color + `theme: dark|light` | **Missing** | Use `#0B1020` / `dark` to match a dark icon. |

### 4.2 Publishing-hard rules (from the official publishing page)

- The `icon` **may not be SVG**; `vsce` refuses to publish user-provided SVG images anywhere.
- Badges may only come from approved providers (`img.shields.io`, `badge.buildkite.com`,
  `github.com` **workflow badges only**, `vsmarketplacebadges.dev`, etc.). **`shields.io` →
  `img.shields.io`.** Do not hotlink custom SVGs.
- Every image URL in `README.md` / `CHANGELOG.md` must resolve to **HTTPS**.
- Images in README/CHANGELOG may not be SVG except from approved badge providers.
- **Size limit:** the official docs state **no numeric package-size limit**. Empirically the
  Marketplace rejects large uploads with `error: Extension package is malformed/corrupted`, and
  third-party reports place practical trouble in the tens of MB. **Target < 5 MB** by bundling
  with esbuild (`PROJECT.md` §7) and keeping screenshots out of the VSIX when possible. Treat any
  size as a risk that must be measured, not assumed — record the `.vsix` size in the release notes.
- The extension must **not** use platform-specific binaries (none planned) — so a single universal
  package is correct and `--target` is unnecessary.

### 4.3 Screenshot plan (what to capture)

All captures: **1440×900 or 1920×1080**, 100% UI scale, no personal paths, no real proprietary
code in frame. Save as PNG under `docs/marketplace/assets/`. Use a sample workspace with
recognisable filenames.

| # | File | Scene | Why |
| --- | --- | --- | --- |
| 01 | `01-hero-dark.png` | Editor panel open, ~8 timeline cards visible (2 expanded with line+word diffs), stats strip, dark theme. Crop to remove desktop chrome. | First impression; the "hero" of the listing. |
| 02 | `02-sidebar-light.png` | Activity Bar sidebar (`codetrail.view`) with 4–5 event cards, light theme, a saved-file card and a task card. | Proves the always-available surface. |
| 03 | `03-diff-word-level.png` | One expanded card showing added/removed context lines, line numbers, intra-line word highlight, `+N / −N`. | Core value; highest-detail asset. |
| 04 | `04-stats-filters.png` | Full panel: animated counters + filter bar (type/file/time/free text) with an active filter chip. | Shows it is more than a log. |
| 05 | `05-terminal-and-debug.png` | Cards for a terminal command (shell integration available) and a debug session start/terminate. | Breadth beyond text edits. |
| 06 | `06-theme-and-rtl-strip.png` | 3-up strip: light, high-contrast, and Persian RTL. | Brand rule proof + accessibility claim. |
| 07 | `07-export-dialog.png` | Export JSON / Export Markdown in progress with native save dialog. | Shows data portability, privacy-safe. |
| 08 | `08-empty-and-first-run.png` | Empty state with the explicit "no results"/first-run tip. | Quality signal (designers notice empty states). |
| 09 | `09-icon-256.png` | The actual icon at 256×256 (also used in `package.json`). | Consistency check. |

Also capture **status bar** (pause/resume) either inside 01 or as a 20-second GIF
(`10-statusbar-pause.gif`, ≤ 2 MB) — motion sells "live" better than a still.

### 4.4 `.vscodeignore` review

Current file:

```
**/*.ts
**/*.map
.vscode/**
test/**
.eslintrc*
eslint.config.mjs
.gitignore
```

Add (recommended) so dev-only material never ships:

```
docs/**
node_modules/**
.git/**
src/**
tsconfig.json
npm-debug.log
*.vsix
assets/**
```

Keep `images/**` (icon + README screenshots) included. Verify with `vsce ls --tree` before
publishing, and confirm `docs/` is **not** in the package.

---

## 5. Publish runbook (author executes)

> **Who does what.** The agent verified names, docs and versions. **The author** must do all
> account creation, identity verification, publisher registration, PAT creation, legal-terms
> acceptance, and the actual `publish`. Credentials must never be shared with the agent or
> committed to the repo.

### 5.0 Prerequisites (verify locally)

```bash
node --version        # must be >= 22 for @vscode/vsce 4.x
npm --version
cd /e/SMH/CodeTrail
npm run check         # per PROJECT.md §8 (typecheck + lint + unit tests)
```

Publisher ID goes in `package.json` **exactly** as `smh-dev-ai` (lowercase, hyphen). IDs are
immutable once created — double-check the spelling before clicking Create.

### 5.1 Create the Azure DevOps organization

1. Sign in to <https://go.microsoft.com/fwlink/?LinkId=307137> with the **Microsoft account** you
   want to own this publisher (`dev.smh.ai@gmail.com` per `PROJECT.md`).
2. Create an organization if none exists (<https://learn.microsoft.com/azure/devops/organizations/accounts/create-organization>).
3. Note the org URL: `https://dev.azure.com/<your-org>`.

### 5.2 Create the Personal Access Token (Marketplace → Manage)

1. In Azure DevOps, user-settings menu (next to profile image) → **Personal access tokens** →
   **New Token**.
2. Fill in **exactly**:
   - **Name:** `vsce-codetrail`
   - **Organization:** **All accessible organizations**  ← the #1 cause of `403 Forbidden`
   - **Expiration:** shortest that covers your release window (e.g. 30 days). Global PATs are being
     decommissioned (see §6), so do not create a long-lived one.
   - **Scopes:** **Custom defined** → *Show all scopes* → scroll to **Marketplace** → tick **Manage**
     → nothing else.
3. **Create** → copy the token immediately (shown once).

> ⚠️ **Acceptance check:** if your token page offers a choice between "Global" and
> per-organization tokens, choose the form Microsoft labels as the one that still works with
> Marketplace; the docs still require "All accessible organizations" + `Marketplace (Manage)`.

### 5.3 Create the publisher on the Marketplace

1. Go to <https://marketplace.visualstudio.com/manage> and sign in with the **same** Microsoft
   account.
2. Left pane → **Create publisher**.
   - **ID:** `smh-dev-ai`  (immutable; becomes `smh-dev-ai.codetrail`)
   - **Name:** a public display name, e.g. **`SMH Dev AI`** (this is shown on the listing; it can
     be changed later but changing it **revokes** any verified badge).
   - Optional: description, logo (square PNG), links to GitHub / Hugging Face.
3. **Create**.

📸 **Screenshots to capture (for the project's own records):**
- `manage-create-publisher.png` — the filled Create-publisher form (ID + Name).
- `manage-publisher-list.png` — publisher listed on <https://marketplace.visualstudio.com/manage>.

### 5.4 Install `@vscode/vsce` and log in

```bash
npm install -g @vscode/vsce
vsce --version          # expect 4.x (4.1.1 at time of writing)

cd /e/SMH/CodeTrail
vsce login smh-dev-ai   # prompts: "Personal Access Token for publisher 'smh-dev-ai':"
```

Expected on success:

```
The Personal Access Token verification succeeded for the publisher 'smh-dev-ai'.
```

If you get `403`/`401`: re-check **organization = All accessible organizations** and
**scope = Marketplace (Manage)**. If you get `ERROR  Not found`: the publisher ID does not exist
or is misspelled.

📸 `vsce-login-success.png` — terminal showing the success line (token masked).

### 5.5 Package (dry run, no network publish)

```bash
vsce ls --tree                 # inspect contents; docs/, src/, test/ must be absent
vsce package                   # -> codetrail-<version>.vsix
```

Then **install the VSIX into a clean window** and smoke-test:

```bash
code --install-extension codetrail-<version>.vsix
```

Checklist before publish:
- [ ] Icon renders in the Extensions list (not a blank square).
- [ ] `vsce ls --tree` contains `README.md`, `CHANGELOG.md`, `LICENSE`, `images/**`, `dist/**`.
- [ ] `.vsix` size recorded and < 5 MB.
- [ ] No `docs/`, `src/`, `test/`, `node_modules/` in the package.
- [ ] README relative images resolve (the committed repository branch contains `images/**`).
- [ ] Privacy claim verified: no network code paths.
- [ ] Installs and activates in light, dark, high-contrast, LTR and RTL.

📸 `vsce-package-output.png`, `vsix-size.png`, `vsce-ls-tree.png`.

### 5.6 Publish

```bash
vsce publish                   # publishes package.json version as-is
# or bump in one step:
vsce publish patch             # 0.1.0 -> 0.1.1
vsce publish minor             # 0.1.0 -> 0.2.0
```

- Publishing from a **git repo** makes `vsce` create a version commit + `v<version>` tag via
  `npm-version`. Since `E:\SMH\CodeTrail` is **not yet a git repo**, initialise and commit first
  if you want that behaviour, or publish from a non-git checkout (no tag/commit).
- **Pre-release** (optional, later): `vsce publish --pre-release`. Constraints: `major.minor.patch`
  only (no semver pre-release suffixes); pre-release and stable versions must differ; recommended
  scheme `0.2.*` stable / `0.3.*` pre-release; requires `engines.vscode >= 1.63.0`.
- Do **not** run `vsce publish` until §5.5 passes.

📸 `vsce-publish-success.png` — terminal line `DONE  Published smh-dev-ai.codetrail@0.1.0.`

### 5.7 Post-publish verification (do all of it)

| Check | URL / command | Expected |
| --- | --- | --- |
| Listing page loads | `https://marketplace.visualstudio.com/items?itemName=smh-dev-ai.codetrail` | 200, hero + README rendered |
| Publisher page loads | `https://marketplace.visualstudio.com/publishers/smh-dev-ai` | 200, shows the extension |
| API exact-ID query | `filterType 7`, value `smh-dev-ai.codetrail` | HTTP 200, `TotalCount: 1` |
| Search visibility | `filterType 10`, value `codetrail` | HTTP 200; `smh-dev-ai.codetrail` present with displayName **CodeTrail Live** |
| Install from Marketplace | `code --install-extension smh-dev-ai.codetrail` | installs, versions match `package.json` |
| Resources panel | listing sidebar | Issues/Repository/Homepage/License all resolve (200) |
| README images | listing body | all render; every `src` is HTTPS |
| Categories/keywords | listing "Categories"/"Tags" | as intended; keyword chips ≤ 30 |
| Size/version report | Marketplace → Manage → **Reports** | correct version and size |
| Activation | Extension Host / devtools | no `onStartupFinished` wake-up at idle |

Re-run the API probe after publish:

```bash
curl -sS -X POST "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery" \
  -H "Content-Type: application/json" -H "Accept: application/json;api-version=7.2-preview.1" \
  -d '{"filters":[{"criteria":[{"filterType":7,"value":"smh-dev-ai.codetrail"}]}],"assetTypes":[],"flags":914}'
```

📸 `post-publish-listing.png`, `post-publish-install.png`, `post-publish-api-query.png`.

### 5.8 Version note: `0.0.1` vs `0.1.0`

The manifest is at `0.0.1`. A first public release at `0.0.1` looks unfinished to users. Prefer
**`0.1.0`** (or keep `0.0.x` and set `"preview": true`). Whichever you choose, it must be **higher
than any version already published** — you cannot re-publish a version number after deletion.

### 5.9 Optional: verified publisher (do not attempt for v1)

Requires **≥ 6 months** of published extensions **and** a domain registered **≥ 6 months** old;
must not be a subdomain; HTTPS; responds 200 to HEAD. Verification is a DNS `TXT` record + manual
Marketplace review (≈5 business days). Not available at first release. Changing the publisher
**display name** later revokes the badge.

---

## 6. Risks

### R1 — Display-name collision with the existing "CodeTrail" extension (medium; resolved)

`CodeTrail.codetrail` (displayName **CodeTrail**, published 2023-11-17) already occupies the
exact Marketplace display name. It is an unrelated code-annotation extension, not a live
activity feed.

- **Resolution:** keep `name: "codetrail"` (publisher-scoped ID) and ship
  `displayName: "CodeTrail Live"`. The UI, commands, repository, and status bar remain
  **CodeTrail**.
- **Search:** the qualifier also helps differentiate from the unrelated extension. Keep the
  summary line first ("see every change in your workspace") and avoid keyword stuffing.
- **GitHub:** unrelated projects named CodeTrail exist (`mdemirhan/codetrail`,
  `itsabhinav0x/CodeTrail`, …). GitHub names are owner-scoped, so
  `SMH-AI-Dev/CodeTrail` is unaffected.

### R2 — Display-name uniqueness and squatting (low, but real)

- `displayName` must be **globally unique**; the Marketplace rejects duplicates with
  `ERROR The extension 'name' already exists in the Marketplace.` (the FAQ says the same rule
  applies to display names).
- `CodeTrail` is already taken by `CodeTrail.codetrail`; `CodeTrail Live` is the chosen
  qualifier. Names are not reservations until the first successful publish.
- **Mitigation:** register the publisher and make the **first** publish promptly (even `0.0.1`
  pre-release) to lock in name + displayName + publisher. Do not sit on the verified-free ID.
- Precedent that popular generic display names get claimed: `Live Server`
  (`ritwickdey.LiveServer`), `Live Share` (`MS-vsliveshare.vsliveshare`), `Live Preview`
  (`ms-vscode.live-server`). A bare "CodeTrail" is **taken**; the qualified **CodeTrail Live**
  is the publishable form.

### R3 — PAT decommissioning (high impact, near-term deadline)

Microsoft is retiring **global** Azure DevOps PATs. Per the Azure DevOps blog (updated
**2026-11-02**), the decommission date was moved from **1 Dec 2026 → 27 Jan 2027** (postponed to
avoid holiday disruption). Creation of new global PATs was **not** blocked (the 15 Mar 2026
block was cancelled). The official VS Code publishing page still says "December 1, 2026" — treat
**27 Jan 2027** as the operative date but verify before publishing.

Implication: a PAT-based `vsce login`/`publish` **works today** (2026-11-21) but **will break by
early 2027**. Plan the migration now:
- Preferred: **Trusted Publishing** — `vsce publish --oidc` from GitHub Actions with an OIDC
  policy on the Marketplace publisher page (repo owner `SMH-AI-Dev`, repo `CodeTrail`,
  workflow e.g. `publish.yml`). No stored secret.
- Alternative: **Azure Pipelines + Microsoft Entra ID** via `vsce publish --azure-credential`
  (workload-identity service connection + user-assigned managed identity with **Contributor** on
  the publisher).
- Not supported: OIDC from any CI other than GitHub Actions/Azure Pipelines.
- Practical order: do the **first** release by hand with a short-lived PAT, then move CI to OIDC
  before the next release.

### R4 — Metadata/asset gaps that block a clean publish (high, immediate)

Missing `LICENSE`, `CHANGELOG.md`, icon, and a Marketplace-ready README are **hard quality gaps**
and several will make the listing look broken. All are cheap to fix and are prerequisites to §5.5.

### R5 — `activationEvents: onStartupFinished` (accepted tradeoff)

CodeTrail activates on window open **by design** (§0, §2.5) so it captures changes before the
panel is opened. Mitigations: keep `activate()` under a few milliseconds, create no webview or
timers until an edit arrives, honor `codetrail.enabled` early, and state the tradeoff in the
README. Revisit if VS Code adds a supported lazy-tracking API.

### R6 — Node/vsce version drift (low)

`@vscode/vsce@4.x` requires **Node ≥ 22** (`4.1.1`, published 2026-11-12; `3.9.2` was the last
`>= 20` release). The shell used for this report runs **Node v26.13.0** (OK; the IDE may report
v24.x). If CI or another machine runs Node 18
or 20, pin vsce to `3.9.2` or upgrade Node. `vsce` (unscoped) is deprecated
("vsce has been renamed to @vscode/vsce. Install using @vscode/vsce instead.") — never install the
unscoped package.

### R7 — Repository not yet created / not a git repo (low-medium)

`repository`/`bugs`/`homepage` links will be dead until `SMH-AI-Dev/CodeTrail` exists and is
public. Creating it **before** `vsce package` avoids broken Resources links and mis-rendered
README-relative images. Also decide now whether `vsce publish` should auto-commit/tag (requires a
git repo).

### R8 — Category over-claiming (low)

Choosing `SCM Providers` to gain visibility risks complaints that CodeTrail is not an SCM provider.
Default to `["Other"]` for v1 (§2.2).

---

## 7. Source register (accessed 2026-11-21)

| Topic | URL |
| --- | --- |
| Publishing extensions (vsce, publisher, PAT, pre-release, verified publisher, presentation tips) | <https://code.visualstudio.com/api/working-with-extensions/publishing-extension> |
| Extension manifest (icon 128×128 PNG, keywords ≤ 30, exact category list, repository/bugs/homepage, galleryBanner, pricing) | <https://code.visualstudio.com/api/references/extension-manifest> |
| Activation events (implicit activation since 1.74, `onStartupFinished` semantics) | <https://code.visualstudio.com/api/references/activation-events> |
| `@vscode/vsce` README (Node ≥ 22, `--oidc`, `VSCE_PAT`, targets) | <https://github.com/microsoft/vscode-vsce> |
| `@vscode/vsce` package metadata (4.1.1 latest, `engines.node >= 22`) | <https://registry.npmjs.org/@vscode%2Fvsce> |
| Legacy `vsce` deprecation notice | <https://registry.npmjs.org/vsce> |
| Global PAT retirement (dates, OIDC guidance) | <https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/> |
| Marketplace search API (filterType 7/10) | <https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery> |
| Publisher management | <https://marketplace.visualstudio.com/manage> |
| Azure DevOps org creation | <https://learn.microsoft.com/azure/devops/organizations/accounts/create-organization> |
| Azure DevOps PAT creation | <https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate> |
| Package-size field reports | <https://blog.clydedsouza.net/posts/reducing-a-visual-studio-extension-file-size>, <https://github.com/microsoft/vscode-vsce/issues/153> |
