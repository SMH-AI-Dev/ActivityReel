/**
 * Runtime validation for messages coming from the extension host. Host messages are trusted in
 * principle, but the webview treats them as untrusted at runtime: unknown types are ignored,
 * required fields are checked minimally and arrays are capped so a malformed payload can never
 * freeze the UI.
 */
import type {
  ActivityEvent,
  DiffHunk,
  DiffLine,
  DiffPayload,
  DiffStat,
  Direction,
  EventKind,
  EventStatus,
  Filters,
  ResolvedLocale,
  SessionStats,
  Settings,
  Surface,
  TimeRange,
  WordSegment,
} from "../../../src/shared/model";
import type { HostMessage } from "../../../src/shared/protocol";

export const MAX_MESSAGE_EVENTS = 5000;
export const MAX_MESSAGE_HUNKS = 2000;
export const MAX_HUNK_LINES = 20000;
export const MAX_STATE_EXPANDED = 200;

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optNum(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const KINDS: readonly EventKind[] = [
  "edit",
  "save",
  "file-create",
  "file-delete",
  "file-rename",
  "file-change",
  "task",
  "debug",
  "terminal",
];

const STATUSES: readonly EventStatus[] = ["running", "done", "failed"];

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is EventStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

function capArray<T>(value: unknown, max: number, map: (item: unknown) => T | undefined): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  const limit = Math.min(value.length, max);
  for (let i = 0; i < limit; i++) {
    const mapped = map(value[i]);
    if (mapped !== undefined) out.push(mapped);
  }
  return out;
}

/**
 * `DiffStat` (src/shared/model.ts) has no fields for the truncation counts, so they are carried
 * on the stat object at runtime when the host provides them (optional, extra keys).
 */
export interface DiffStatExtras {
  shownLines?: number;
  totalLines?: number;
}

function diffStat(value: unknown): DiffStat & DiffStatExtras {
  const d = isDict(value) ? value : {};
  const stat: DiffStat & DiffStatExtras = {
    added: num(d.added),
    removed: num(d.removed),
    hunks: num(d.hunks),
    truncated: d.truncated === true,
  };
  const shown = optNum(d.shownLines);
  const total = optNum(d.totalLines);
  if (shown !== undefined) stat.shownLines = shown;
  if (total !== undefined) stat.totalLines = total;
  return stat;
}

export function parseEvent(value: unknown): ActivityEvent | undefined {
  if (!isDict(value)) return undefined;
  const kind = value.kind;
  if (!isEventKind(kind)) return undefined;
  if (typeof value.id !== "string" || !value.id) return undefined;
  const base = {
    id: value.id,
    seq: num(value.seq),
    sessionId: str(value.sessionId),
    ts: num(value.ts),
    status: isStatus(value.status) ? value.status : ("done" as const),
  };
  switch (kind) {
    case "edit": {
      const reason = value.reason;
      return {
        ...base,
        kind,
        relPath: str(value.relPath),
        languageId: typeof value.languageId === "string" ? value.languageId : undefined,
        diff: diffStat(value.diff),
        reason: reason === "undo" || reason === "redo" ? reason : undefined,
        eol: value.eol === "\r\n" ? "\r\n" : value.eol === "\n" ? "\n" : undefined,
        searchText: typeof value.searchText === "string" ? value.searchText.slice(0, 400) : undefined,
      };
    }
    case "file-rename":
      return { ...base, kind, relPath: str(value.relPath), fromPath: str(value.fromPath) };
    case "save":
    case "file-create":
    case "file-delete":
    case "file-change": {
      const source = value.source;
      return {
        ...base,
        kind,
        relPath: str(value.relPath),
        source: source === "editor" || source === "watcher" ? source : undefined,
      };
    }
    case "task":
      return {
        ...base,
        kind,
        taskName: str(value.taskName),
        taskSource: str(value.taskSource),
        taskId: typeof value.taskId === "string" ? value.taskId : undefined,
        exitCode: optNum(value.exitCode),
        durationMs: optNum(value.durationMs),
      };
    case "debug":
      return {
        ...base,
        kind,
        debugName: str(value.debugName),
        debugType: str(value.debugType),
        debugSessionId: str(value.debugSessionId),
        durationMs: optNum(value.durationMs),
      };
    case "terminal":
      return {
        ...base,
        kind,
        command: str(value.command),
        cwd: typeof value.cwd === "string" ? value.cwd : undefined,
        exitCode: optNum(value.exitCode),
        durationMs: optNum(value.durationMs),
      };
  }
}

export function parseStats(value: unknown): SessionStats | undefined {
  if (!isDict(value)) return undefined;
  return {
    events: num(value.events),
    files: num(value.files),
    added: num(value.added),
    removed: num(value.removed),
    sessionStartedAt: num(value.sessionStartedAt),
    durationMs: num(value.durationMs),
  };
}

function parseFilters(value: unknown): Filters {
  const d = isDict(value) ? value : {};
  const kinds = Array.isArray(d.kinds) ? d.kinds.filter(isEventKind) : [];
  const range = d.timeRange;
  const timeRange: TimeRange = range === "5m" || range === "1h" ? range : "session";
  return { kinds: [...new Set(kinds)], query: str(d.query).slice(0, 200), timeRange };
}

function parseSettings(value: unknown): Settings {
  const d = isDict(value) ? value : {};
  return {
    enabled: d.enabled !== false,
    maxEvents: num(d.maxEvents, 1000),
    maxDiffLines: num(d.maxDiffLines, 500),
    contextLines: num(d.contextLines, 3),
    debounceMs: num(d.debounceMs, 300),
    persistHistory: d.persistHistory !== false,
    trackFileOperations: d.trackFileOperations !== false,
    trackExternalChanges: d.trackExternalChanges !== false,
    trackTasks: d.trackTasks !== false,
    trackDebug: d.trackDebug !== false,
    trackTerminal: d.trackTerminal !== false,
    excludeGlobs: Array.isArray(d.excludeGlobs)
      ? d.excludeGlobs.filter((g): g is string => typeof g === "string")
      : [],
    maxFileSizeKB: num(d.maxFileSizeKB, 2048),
    statusBar: d.statusBar !== false,
    locale: d.locale === "en" || d.locale === "fa" ? d.locale : "auto",
    openFilesOutsideWorkspace: d.openFilesOutsideWorkspace === true,
  };
}

function parseWords(value: unknown): WordSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: WordSegment[] = [];
  for (const item of value.slice(0, 5000)) {
    if (!isDict(item)) continue;
    out.push({ text: str(item.text), changed: item.changed === true });
  }
  return out.length > 0 ? out : undefined;
}

function parseLine(value: unknown): DiffLine | undefined {
  if (!isDict(value)) return undefined;
  const kind = value.kind;
  if (kind !== "context" && kind !== "added" && kind !== "removed") return undefined;
  return {
    kind,
    text: str(value.text),
    oldLine: optNum(value.oldLine),
    newLine: optNum(value.newLine),
    words: parseWords(value.words),
  };
}

function parseHunk(value: unknown): DiffHunk | undefined {
  if (!isDict(value)) return undefined;
  const lines = capArray(value.lines, MAX_HUNK_LINES, parseLine);
  return {
    header: str(value.header),
    oldStart: num(value.oldStart),
    oldLines: num(value.oldLines),
    newStart: num(value.newStart),
    newLines: num(value.newLines),
    lines,
  };
}

export function parseDiffPayload(value: unknown): DiffPayload | undefined {
  if (!isDict(value) || typeof value.eventId !== "string") return undefined;
  return {
    eventId: value.eventId,
    hunks: capArray(value.hunks, MAX_MESSAGE_HUNKS, parseHunk),
    stat: diffStat(value.stat) as DiffStat,
    mode: value.mode === "coarse" ? "coarse" : "exact",
    fullAvailable: value.fullAvailable === true,
    unified: typeof value.unified === "string" ? value.unified : undefined,
  };
}

const SURFACES: readonly Surface[] = ["panel", "sidebar", "about"];

/** Validate a raw `message` event data payload. Returns undefined for anything unknown/invalid. */
export function parseHostMessage(data: unknown): HostMessage | undefined {
  if (!isDict(data) || typeof data.type !== "string") return undefined;
  switch (data.type) {
    case "init": {
      const stats = parseStats(data.stats);
      if (!stats || typeof data.version !== "string") return undefined;
      const surface = (SURFACES as readonly string[]).includes(str(data.surface))
        ? (data.surface as Surface)
        : "panel";
      const direction: Direction = data.direction === "rtl" ? "rtl" : "ltr";
      const locale: ResolvedLocale = data.locale === "fa" ? "fa" : "en";
      return {
        type: "init",
        protocol: num(data.protocol, 1),
        surface,
        version: data.version,
        locale,
        direction,
        settings: parseSettings(data.settings),
        events: capArray(data.events, MAX_MESSAGE_EVENTS, parseEvent),
        stats,
        paused: data.paused === true,
        filters: parseFilters(data.filters),
        hasMore: data.hasMore === true,
        sessionId: str(data.sessionId),
      };
    }
    case "events":
    case "older": {
      const stats = parseStats(data.stats);
      const events = capArray(data.events, MAX_MESSAGE_EVENTS, parseEvent);
      if (data.type === "events") {
        if (!stats) return undefined;
        return { type: "events", events, stats, hasMore: data.hasMore === true };
      }
      return { type: "older", events, hasMore: data.hasMore === true };
    }
    case "event-update": {
      const event = parseEvent(data.event);
      const stats = parseStats(data.stats);
      if (!event || !stats) return undefined;
      return { type: "event-update", event, stats };
    }
    case "diff": {
      const payload = parseDiffPayload(data.payload);
      return payload ? { type: "diff", payload } : undefined;
    }
    case "diff-expired":
      return typeof data.id === "string" && data.id ? { type: "diff-expired", id: data.id } : undefined;
    case "state":
      return { type: "state", paused: data.paused === true, settings: parseSettings(data.settings) };
    case "filters":
      return { type: "filters", filters: parseFilters(data.filters) };
    case "stats": {
      const stats = parseStats(data.stats);
      return stats ? { type: "stats", stats } : undefined;
    }
    case "cleared":
      return { type: "cleared" };
    case "toast": {
      const level = data.level === "error" || data.level === "warn" ? data.level : "info";
      return { type: "toast", level, message: str(data.message).slice(0, 500) };
    }
    default:
      return undefined;
  }
}

export interface PersistedUiState {
  expanded: string[];
  anchor: number;
  filterPanelOpen: boolean;
}

export function parsePersistedState(value: unknown): PersistedUiState {
  const d = isDict(value) ? value : {};
  const expanded = Array.isArray(d.expanded)
    ? d.expanded.filter((id): id is string => typeof id === "string").slice(0, MAX_STATE_EXPANDED)
    : [];
  return {
    expanded,
    anchor: Math.max(0, num(d.anchor)),
    filterPanelOpen: d.filterPanelOpen === true,
  };
}
