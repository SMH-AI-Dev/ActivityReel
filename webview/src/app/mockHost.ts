/**
 * Browser-preview mock host. It speaks the exact `HostMessage` / `WebviewMessage` protocol the
 * extension host uses, so the standalone Vite preview exercises the real UI code paths:
 * `ready` -> `init`, live `events` batches, `event-update` for running tasks/debug, `diff`
 * payloads on demand, filters, pause and clear — all local, no network.
 */
import type {
  ActivityEvent,
  DiffHunk,
  DiffLine,
  DiffPayload,
  DiffStat,
  EventKind,
  EventStatus,
  Filters,
  SessionStats,
  Settings,
} from "../../../src/shared/model";
import type { HostMessage, WebviewMessage } from "../../../src/shared/protocol";
import { DEFAULT_SETTINGS, PROTOCOL_VERSION } from "../../../src/shared/constants";
import { MOCK_MESSAGE_TYPE } from "./adapters";

export interface MockSeed {
  now: number;
  version: string;
  paused: boolean;
  hasMore: boolean;
  settings: Settings;
  events: ActivityEvent[];
  stats: SessionStats;
  filters: Filters;
  sessionId: string;
}

interface Draft {
  kind: EventKind;
  relPath?: string;
  fromPath?: string;
  languageId?: string;
  lines: DiffLine[];
  stat: DiffStat;
  taskName?: string;
  taskSource?: string;
  command?: string;
  cwd?: string;
  debugName?: string;
  debugType?: string;
  reason?: "undo" | "redo";
  status: EventStatus;
  exitCode?: number;
  durationMs?: number;
  searchText?: string;
}

const LINE = (kind: DiffLine["kind"], text: string, oldLine?: number, newLine?: number, words?: DiffLine["words"]): DiffLine => ({
  kind,
  text,
  oldLine,
  newLine,
  words,
});

function diffLines(added: number, removed: number, hunks: number): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 41;
  let newNo = 41;
  out.push(LINE("context", "const lines = trim(prefix, suffix);", oldNo++, newNo++));
  for (let i = 0; i < removed; i++) {
    out.push(LINE("removed", i === 0 ? "return fastPath(a, b);" : `removed line ${i + 1}`, oldNo++));
  }
  for (let i = 0; i < added; i++) {
    if (i === 0) {
      out.push(
        LINE("added", "return guarded(myers(a, b), limit);", undefined, newNo++, [
          { text: "return ", changed: false },
          { text: "guarded(", changed: true },
          { text: "myers(a, b), limit", changed: false },
          { text: ");", changed: true },
        ]),
      );
    } else {
      out.push(LINE("added", `// ${i}. guard: linear fallback`, undefined, newNo++));
    }
  }
  out.push(LINE("context", "}", oldNo++, newNo++));
  void hunks;
  return out;
}

const SAMPLE_EVENTS: Draft[] = [
  {
    kind: "terminal",
    command: "npm run lint",
    cwd: ".",
    lines: [],
    stat: { added: 0, removed: 0, hunks: 0, truncated: false },
    status: "done",
    exitCode: 0,
    durationMs: 4100,
    searchText: "eslint --max-warnings=0",
  },
  {
    kind: "debug",
    debugName: "launch",
    debugType: "node",
    lines: [],
    stat: { added: 0, removed: 0, hunks: 0, truncated: false },
    status: "running",
  },
  {
    kind: "task",
    taskName: "npm test",
    taskSource: "npm",
    lines: [],
    stat: { added: 0, removed: 0, hunks: 0, truncated: false },
    status: "running",
  },
  {
    kind: "file-rename",
    relPath: "docs/x.md",
    fromPath: "notes/x.md",
    lines: [],
    stat: { added: 0, removed: 0, hunks: 0, truncated: false },
    status: "done",
    searchText: "renamed document",
  },
  {
    kind: "file-create",
    relPath: "webview/src/app/store.ts",
    languageId: "typescript",
    lines: [],
    stat: { added: 214, removed: 0, hunks: 1, truncated: false },
    status: "done",
    searchText: "reduce host events",
  },
  {
    kind: "edit",
    relPath: "src/diff.ts",
    languageId: "typescript",
    lines: diffLines(2, 1, 2),
    stat: { added: 12, removed: 3, hunks: 2, truncated: false },
    status: "done",
    searchText: "guarded(myers(a, b), limit)",
  },
  {
    kind: "save",
    relPath: "src/diff.ts",
    lines: [],
    stat: { added: 0, removed: 0, hunks: 0, truncated: false },
    status: "done",
  },
  {
    kind: "edit",
    relPath: "package.json",
    languageId: "json",
    lines: [LINE("removed", '    "version": "0.0.9",', 3), LINE("added", '    "version": "0.1.0",', undefined, 3)],
    stat: { added: 1, removed: 1, hunks: 1, truncated: false },
    status: "done",
    searchText: '"version": "0.1.0"',
  },
  {
    kind: "task",
    taskName: "npm test",
    taskSource: "npm",
    lines: [],
    stat: { added: 0, removed: 0, hunks: 0, truncated: false },
    status: "failed",
    exitCode: 1,
    durationMs: 1200,
  },
  {
    kind: "terminal",
    command: "git status --short",
    cwd: ".",
    lines: [],
    stat: { added: 0, removed: 0, hunks: 0, truncated: false },
    status: "done",
    exitCode: 0,
    durationMs: 260,
  },
  {
    kind: "edit",
    relPath: "README.md",
    languageId: "markdown",
    lines: [LINE("removed", "old tagline", 4), LINE("added", "See every change in your workspace, live.", undefined, 4)],
    stat: { added: 1, removed: 1, hunks: 1, truncated: false },
    status: "done",
    searchText: "See every change in your workspace, live.",
  },
  {
    kind: "file-change",
    relPath: "src/core/store/eventSink.ts",
    languageId: "typescript",
    lines: [],
    stat: { added: 3, removed: 0, hunks: 1, truncated: false },
    status: "done",
    searchText: "emitBatch",
  },
];

/** A large, truncated diff used when the user expands a very old sample edit. */
function buildTruncatedPayload(eventId: string, maxLines: number): DiffPayload {
  const total = 2341;
  const hunks: DiffHunk[] = [];
  const lines: DiffLine[] = [];
  for (let i = 0; i < maxLines; i++) {
    const no = i + 1;
    lines.push(
      i % 3 === 0
        ? LINE("added", `+ generated line ${no}`, undefined, no, [
            { text: "generated line ", changed: true },
            { text: String(no), changed: false },
          ])
        : LINE("context", `context ${no}`, no, no),
    );
  }
  hunks.push({ header: "@@ -1,1 +1,2341 @@ generated()", oldStart: 1, oldLines: 1, newStart: 1, newLines: total, lines });
  return {
    eventId,
    hunks,
    stat: { added: total, removed: 0, hunks: 1, truncated: true },
    mode: "exact",
    fullAvailable: false,
    unified: lines.map((l) => (l.kind === "added" ? "+" : " ") + l.text).join("\n"),
  };
}

export function createMockSeed(now = Date.now()): MockSeed {
  const start = now - 3 * 60_000 - 42_000;
  let seq = 40;
  const events: ActivityEvent[] = SAMPLE_EVENTS.map((draft, index) => {
    const ts = start + index * 17_000;
    const base = { id: `mock-${seq}`, seq: seq++, sessionId: "mock-session", ts };
    switch (draft.kind) {
      case "edit":
        return {
          ...base,
          kind: "edit",
          relPath: draft.relPath ?? "",
          languageId: draft.languageId,
          diff: draft.stat,
          status: draft.status,
          searchText: draft.searchText,
        };
      case "file-rename":
        return { ...base, kind: "file-rename", relPath: draft.relPath ?? "", fromPath: draft.fromPath ?? "", status: draft.status };
      case "task":
        return {
          ...base,
          kind: "task",
          taskName: draft.taskName ?? "",
          taskSource: draft.taskSource ?? "",
          exitCode: draft.exitCode,
          durationMs: draft.durationMs,
          status: draft.status,
        };
      case "debug":
        return {
          ...base,
          kind: "debug",
          debugName: draft.debugName ?? "",
          debugType: draft.debugType ?? "",
          debugSessionId: `dbg-${seq}`,
          durationMs: draft.durationMs,
          status: draft.status,
        };
      case "terminal":
        return {
          ...base,
          kind: "terminal",
          command: draft.command ?? "",
          cwd: draft.cwd,
          exitCode: draft.exitCode,
          durationMs: draft.durationMs,
          status: draft.status,
        };
      default:
        return {
          ...base,
          kind: draft.kind as "save" | "file-create" | "file-delete" | "file-change",
          relPath: draft.relPath ?? "",
          source: "editor",
          status: draft.status,
        };
    }
  });
  const stats: SessionStats = {
    events: events.length,
    files: 9,
    added: 148,
    removed: 37,
    sessionStartedAt: start,
    durationMs: now - start,
  };
  return {
    now,
    version: "0.1.0",
    paused: false,
    hasMore: true,
    settings: { ...DEFAULT_SETTINGS },
    events,
    stats,
    filters: { kinds: [], query: "", timeRange: "session" },
    sessionId: "mock-session",
  };
}

function diffFor(event: ActivityEvent, draftIndex: number, maxLines: number): DiffPayload | undefined {
  const draft = SAMPLE_EVENTS[draftIndex];
  const stat =
    event.kind === "edit"
      ? event.diff
      : draft?.stat ?? (event.kind === "file-create" ? { added: 214, removed: 0, hunks: 1, truncated: false } : undefined);
  if (!stat || (stat.added === 0 && stat.removed === 0 && stat.hunks === 0)) {
    if (!draft || draft.lines.length === 0) return undefined;
  }
  if (draft && draft.lines.length > 0) {
    return {
      eventId: event.id,
      hunks: [
        {
          header: "@@ -1,1 +1,1 @@",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: draft.lines,
        },
      ],
      stat,
      mode: "exact",
      fullAvailable: true,
      unified: draft.lines.map((l) => (l.kind === "removed" ? "-" : l.kind === "added" ? "+" : " ") + l.text).join("\n"),
    };
  }
  if (event.kind === "file-create") {
    return buildTruncatedPayload(event.id, Math.min(maxLines, 80));
  }
  return undefined;
}

export interface MockHost {
  start(): void;
  stop(): void;
}

export function startMockHost(options?: { seed?: MockSeed; stream?: boolean }): MockHost {
  const seed = options?.seed ?? createMockSeed();
  const stream = options?.stream ?? true;
  const posted: WebviewMessage[] = [];
  let state: MockSeed = seed;
  let timers: ReturnType<typeof setTimeout>[] = [];

  const send = (message: HostMessage) => {
    window.postMessage(message, "*");
  };

  const handle = (message: WebviewMessage) => {
    posted.push(message);
    switch (message.type) {
      case "ready":
        send({
          type: "init",
          protocol: PROTOCOL_VERSION,
          surface: (window.__ACTIVITYREEL__?.surface as "panel" | "sidebar" | "about" | undefined) ?? "panel",
          version: state.version,
          locale: window.__ACTIVITYREEL__?.locale === "fa" ? "fa" : "en",
          direction: window.__ACTIVITYREEL__?.locale === "fa" ? "rtl" : "ltr",
          settings: state.settings,
          events: state.events,
          stats: state.stats,
          paused: state.paused,
          filters: state.filters,
          hasMore: state.hasMore,
          sessionId: state.sessionId,
        });
        break;
      case "requestDiff": {
        const index = state.events.findIndex((e) => e.id === message.id);
        const event = state.events[index];
        if (!event) {
          setTimeout(() => send({ type: "diff", payload: { eventId: message.id, hunks: [], stat: { added: 0, removed: 0, hunks: 0, truncated: false }, mode: "exact", fullAvailable: false } }), 120);
          break;
        }
        const payloadTimeout = setTimeout(() => {
          const payload = diffFor(event, index, state.settings.maxDiffLines);
          if (payload) {
            send({ type: "diff", payload });
          } else {
            send({ type: "toast", level: "info", message: "No diff is retained for this event." });
          }
        }, 220);
        timers.push(payloadTimeout);
        break;
      }
      case "open":
        send({
          type: "toast",
          level: "info",
          message: window.__ACTIVITYREEL__?.locale === "fa" ? "در نسخهٔ پیش‌نمایش فایل باز نمی‌شود." : "Preview mode: the file would open in your editor.",
        });
        break;
      case "copy":
      case "copyDiff":
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(message.type === "copy" ? message.text : "").catch(() => undefined);
        }
        send({ type: "toast", level: "info", message: window.__ACTIVITYREEL__?.locale === "fa" ? "در کلیپ‌بورد کپی شد." : "Copied to clipboard." });
        break;
      case "requestOlder": {
        const next = makeOlderBatch(state, message.beforeSeq);
        setTimeout(() => send({ type: "older", events: next.events, hasMore: next.hasMore }), 180);
        break;
      }
      case "setFilters":
        state = { ...state, filters: message.filters };
        send({ type: "filters", filters: message.filters });
        break;
      case "pause":
        state = { ...state, paused: message.value };
        send({ type: "state", paused: message.value, settings: state.settings });
        send({ type: "toast", level: "info", message: message.value ? "Tracking paused." : "Tracking resumed." });
        break;
      case "clear":
        send({ type: "cleared" });
        state = { ...state, events: [], hasMore: false };
        break;
      case "export":
        send({ type: "toast", level: "info", message: "Preview mode: export is handled by the extension host." });
        break;
      case "openAbout":
        send({ type: "toast", level: "info", message: "Preview mode: About opens in a new panel." });
        break;
      case "openPanel":
        send({ type: "toast", level: "info", message: "Preview mode: the full panel is a separate webview." });
        break;
      default:
        break;
    }
  };

  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; message?: unknown } | null;
    if (!data || data.type !== MOCK_MESSAGE_TYPE) return;
    const message = data.message as WebviewMessage | undefined;
    if (message && typeof message === "object" && typeof message.type === "string") handle(message);
  };

  if (stream) {
    timers.push(
      setTimeout(() => {
        // Finish the running task and terminate the debug session.
        for (const e of state.events) {
          if (e.kind === "task" && e.status === "running") {
            send({
              type: "event-update",
              event: { ...e, status: "done", exitCode: 0, durationMs: 2100 },
              stats: state.stats,
            });
          }
        }
      }, 2500),
    );
  }

  window.addEventListener("message", onMessage);
  return {
    start: () => undefined,
    stop: () => {
      window.removeEventListener("message", onMessage);
      for (const t of timers) clearTimeout(t);
      timers = [];
    },
  };
}

function makeOlderBatch(state: MockSeed, beforeSeq: number): { events: ActivityEvent[]; hasMore: boolean } {
  const oldest = beforeSeq;
  if (!Number.isFinite(oldest) || oldest <= 1) return { events: [], hasMore: false };
  const events: ActivityEvent[] = [];
  const count = Math.min(20, oldest);
  for (let i = 0; i < count; i++) {
    const seq = oldest - 1 - i;
    if (seq < 0) break;
    const now = state.now;
    events.push({
      id: `mock-${seq}`,
      seq,
      sessionId: state.sessionId,
      ts: now - (oldest - seq) * 9_000,
      status: "done",
      kind: "edit",
      relPath: `src/core/patch-${seq % 7}.ts`,
      languageId: "typescript",
      diff: { added: seq % 5, removed: seq % 3, hunks: 1, truncated: false },
      searchText: `older edit ${seq}`,
    });
  }
  return { events, hasMore: oldest - count > 1 };
}

