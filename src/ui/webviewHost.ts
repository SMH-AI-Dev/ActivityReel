import * as vscode from "vscode";
import { LIMITS, PROTOCOL_VERSION } from "../shared/constants";
import type {
  ActivityEvent,
  DiffPayload,
  EventDraft,
  EventProgressPatch,
  Filters,
  ResolvedLocale,
  SessionStats,
  Settings,
  Surface,
  TimeRange,
} from "../shared/model";
import type { HostMessage } from "../shared/protocol";
import type { Page } from "../core/store/activityStore";
import type { EventSink } from "../core/store/eventSink";
import { directionForLocale } from "./i18n";
import { renderWebviewHtml } from "./webviewHtml";

const KIND_SET: ReadonlySet<string> = new Set([
  "edit",
  "save",
  "file-create",
  "file-delete",
  "file-rename",
  "file-change",
  "task",
  "debug",
  "terminal",
]);
const TIME_RANGES: ReadonlySet<string> = new Set(["session", "5m", "1h"]);
const MAX_ID_CHARS = 200;
const MAX_QUERY_CHARS = 200;

/** Everything the webview needs from the extension host; implemented by `extension.ts`. */
export interface WebviewFacade {
  readonly version: string;
  locale(): ResolvedLocale;
  settings(): Settings;
  paused(): boolean;
  filters(): Filters;
  sessionId(): string;
  stats(): SessionStats;
  pageNewest(): Page;
  pageOlder(beforeSeq: number): Page;
  getEvent(id: string): ActivityEvent | undefined;
  getDiff(id: string): DiffPayload | undefined;
  openEvent(id: string): void;
  setFilters(filters: Filters): void;
  setPaused(paused: boolean): void;
  requestClear(): void;
  requestExport(format: "json" | "markdown"): void;
  copyText(text: string): void;
  openAbout(): void;
  openPanel(): void;
}

interface Session {
  readonly webview: vscode.Webview;
  readonly surface: Surface;
  readonly listener: vscode.Disposable;
  ready: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeFilters(raw: unknown, fallback: Filters): Filters {
  if (!isRecord(raw)) return fallback;
  const kinds: Filters["kinds"] = [];
  if (Array.isArray(raw.kinds)) {
    for (const kind of raw.kinds) {
      if (typeof kind === "string" && KIND_SET.has(kind) && !kinds.includes(kind as Filters["kinds"][number])) {
        kinds.push(kind as Filters["kinds"][number]);
      }
    }
  }
  const query = typeof raw.query === "string" ? raw.query.slice(0, MAX_QUERY_CHARS) : "";
  const timeRange =
    typeof raw.timeRange === "string" && TIME_RANGES.has(raw.timeRange)
      ? (raw.timeRange as TimeRange)
      : "session";
  return { kinds, query, timeRange };
}

function diffTextForClipboard(payload: DiffPayload): string {
  if (payload.unified !== undefined && payload.unified.trim().length > 0) return payload.unified;
  const lines: string[] = [];
  for (const hunk of payload.hunks) {
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      const prefix = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
      lines.push(`${prefix}${line.text}`);
    }
  }
  return lines.join("\n");
}

function capUtf8Bytes(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  return new TextDecoder().decode(bytes.subarray(0, maxBytes));
}

/**
 * Owns the webview sessions for all surfaces: renders the HTML shell, answers `ready` with a
 * snapshot, batches mutations at `dispatchBatchMs`, and handles per-session lazy requests.
 */
export class WebviewHub {
  private readonly sessions = new Map<vscode.Webview, Session>();
  private readonly pendingEvents = new Map<string, ActivityEvent>();
  private readonly pendingUpdates = new Map<string, ActivityEvent>();
  private pendingCleared = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private readonly facade: WebviewFacade,
    private readonly extensionUri: vscode.Uri,
  ) {}

  attach(webview: vscode.Webview, surface: Surface): void {
    if (this.disposed) return;
    this.detach(webview);
    webview.options = {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webview.html = renderWebviewHtml(webview, this.extensionUri, surface, this.facade.locale());
    const listener = webview.onDidReceiveMessage((raw: unknown) => this.receive(webview, raw));
    this.sessions.set(webview, { webview, surface, listener, ready: false });
  }

  detach(webview: vscode.Webview): void {
    const session = this.sessions.get(webview);
    if (!session) return;
    session.listener.dispose();
    this.sessions.delete(webview);
  }

  enqueueEvent(event: ActivityEvent): void {
    if (this.disposed) return;
    this.pendingUpdates.delete(event.id);
    this.pendingEvents.set(event.id, event);
    this.schedule();
  }

  enqueueUpdate(event: ActivityEvent): void {
    if (this.disposed) return;
    if (this.pendingEvents.has(event.id)) this.pendingEvents.set(event.id, event);
    else this.pendingUpdates.set(event.id, event);
    this.schedule();
  }

  notifyCleared(): void {
    if (this.disposed) return;
    this.pendingEvents.clear();
    this.pendingUpdates.clear();
    this.pendingCleared = true;
    this.flush();
  }

  broadcastState(paused: boolean, settings: Settings): void {
    this.post({ type: "state", paused, settings });
  }

  broadcastFilters(filters: Filters): void {
    this.post({ type: "filters", filters });
  }

  broadcastStats(stats: SessionStats): void {
    this.post({ type: "stats", stats });
  }

  broadcastToast(level: "info" | "warn" | "error", message: string): void {
    this.post({ type: "toast", level, message });
  }

  /** Re-sends the full snapshot (locale/direction changes, toolbar resync). */
  sendInitAll(): void {
    for (const session of this.sessions.values()) {
      if (session.ready) this.postInit(session);
    }
  }

  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.disposed) return;

    const cleared = this.pendingCleared;
    const events = [...this.pendingEvents.values()].sort((a, b) => a.seq - b.seq);
    const updates = [...this.pendingUpdates.values()];
    this.pendingCleared = false;
    this.pendingEvents.clear();
    this.pendingUpdates.clear();

    for (const session of this.readySessions()) {
      if (cleared) this.send(session, { type: "cleared" });
      if (events.length > 0) {
        this.send(session, {
          type: "events",
          events,
          stats: this.facade.stats(),
          hasMore: this.facade.pageNewest().hasMore,
        });
      }
      for (const event of updates) {
        this.send(session, { type: "event-update", event, stats: this.facade.stats() });
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    for (const session of this.sessions.values()) session.listener.dispose();
    this.sessions.clear();
    this.pendingEvents.clear();
    this.pendingUpdates.clear();
  }

  private schedule(): void {
    if (this.timer !== undefined || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, LIMITS.dispatchBatchMs);
  }

  private readySessions(): Session[] {
    return [...this.sessions.values()].filter((session) => session.ready);
  }

  private post(message: HostMessage): void {
    for (const session of this.readySessions()) this.send(session, message);
  }

  private send(session: Session, message: HostMessage): void {
    void session.webview.postMessage(message);
  }

  private postInit(session: Session): void {
    const page = this.facade.pageNewest();
    const locale = this.facade.locale();
    this.send(session, {
      type: "init",
      protocol: PROTOCOL_VERSION,
      surface: session.surface,
      version: this.facade.version,
      locale,
      direction: directionForLocale(locale),
      settings: this.facade.settings(),
      events: page.events,
      stats: this.facade.stats(),
      paused: this.facade.paused(),
      filters: this.facade.filters(),
      hasMore: page.hasMore,
      sessionId: this.facade.sessionId(),
    });
  }

  private receive(webview: vscode.Webview, raw: unknown): void {
    if (this.disposed) return;
    const session = this.sessions.get(webview);
    if (!session || !isRecord(raw) || typeof raw.type !== "string") return;

    switch (raw.type) {
      case "ready":
        session.ready = true;
        this.postInit(session);
        return;
      case "open":
        if (typeof raw.id === "string" && raw.id.length <= MAX_ID_CHARS) this.facade.openEvent(raw.id);
        return;
      case "requestDiff": {
        if (typeof raw.id !== "string" || raw.id.length > MAX_ID_CHARS) return;
        const payload = this.facade.getDiff(raw.id);
        if (payload) this.send(session, { type: "diff", payload });
        else this.send(session, { type: "diff-expired", id: raw.id });
        return;
      }
      case "copy":
        if (typeof raw.text === "string") this.facade.copyText(capUtf8Bytes(raw.text, LIMITS.maxClipboardBytes));
        return;
      case "copyDiff": {
        if (typeof raw.id !== "string" || raw.id.length > MAX_ID_CHARS) return;
        const payload = this.facade.getDiff(raw.id);
        if (!payload) {
          this.send(session, { type: "diff-expired", id: raw.id });
          return;
        }
        this.facade.copyText(capUtf8Bytes(diffTextForClipboard(payload), LIMITS.maxClipboardBytes));
        return;
      }
      case "requestOlder": {
        if (typeof raw.beforeSeq !== "number" || !Number.isFinite(raw.beforeSeq) || raw.beforeSeq <= 0) return;
        const page = this.facade.pageOlder(Math.floor(raw.beforeSeq));
        this.send(session, { type: "older", events: page.events, hasMore: page.hasMore });
        return;
      }
      case "setFilters": {
        const filters = sanitizeFilters(raw.filters, this.facade.filters());
        this.facade.setFilters(filters);
        return;
      }
      case "pause":
        if (typeof raw.value === "boolean") this.facade.setPaused(raw.value);
        return;
      case "clear":
        this.facade.requestClear();
        return;
      case "export":
        if (raw.format === "json" || raw.format === "markdown") this.facade.requestExport(raw.format);
        return;
      case "openAbout":
        this.facade.openAbout();
        return;
      case "openPanel":
        this.facade.openPanel();
        return;
      default:
        return;
    }
  }
}

/**
 * Store adapter for trackers. While paused, drafts are dropped (the tracker's own gate is the
 * first line of defense; this one also covers events emitted during pause transitions) and the
 * synthetic return value is never stored, so ids stay unique and seq stays monotonic.
 */
export class FeedSink implements EventSink {
  private droppedCount = 0;

  constructor(
    private readonly store: {
      append(draft: EventDraft): ActivityEvent;
      update(id: string, patch: EventProgressPatch): ActivityEvent | undefined;
      attachDiff(id: string, payload: DiffPayload): void;
      get(id: string): ActivityEvent | undefined;
      readonly sessionId: string;
    },
    private readonly hub: WebviewHub,
    private readonly isPaused: () => boolean,
    private readonly onMutated?: () => void,
  ) {}

  append(draft: EventDraft): ActivityEvent {
    if (this.isPaused()) {
      this.droppedCount += 1;
      return {
        ...draft,
        id: `paused-${this.droppedCount}`,
        seq: 0,
        sessionId: this.store.sessionId,
        ts: Date.now(),
        status: "done",
      } as ActivityEvent;
    }
    const event = this.store.append(draft);
    this.hub.enqueueEvent(event);
    this.onMutated?.();
    return event;
  }

  update(id: string, patch: EventProgressPatch): ActivityEvent | undefined {
    if (this.isPaused()) return undefined;
    const event = this.store.update(id, patch);
    if (event) {
      this.hub.enqueueUpdate(event);
      this.onMutated?.();
    }
    return event;
  }

  attachDiff(id: string, payload: DiffPayload): void {
    if (this.isPaused()) return;
    this.store.attachDiff(id, payload);
    this.onMutated?.();
  }

  get(id: string): ActivityEvent | undefined {
    return this.store.get(id);
  }
}
