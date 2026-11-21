export type Surface = "panel" | "sidebar" | "about";

export type EventKind =
  | "edit"
  | "save"
  | "file-create"
  | "file-delete"
  | "file-rename"
  | "file-change"
  | "task"
  | "debug"
  | "terminal";

export type EventStatus = "running" | "done" | "failed";
export type TimeRange = "session" | "5m" | "1h";
export type TextEditReason = "undo" | "redo";
export type DiffMode = "exact" | "coarse";

export interface DiffStat {
  added: number;
  removed: number;
  hunks: number;
  truncated: boolean;
}

export interface WordSegment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  kind: "context" | "added" | "removed";
  text: string;
  oldLine?: number;
  newLine?: number;
  words?: WordSegment[];
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffPayload {
  eventId: string;
  hunks: DiffHunk[];
  stat: DiffStat;
  mode: DiffMode;
  fullAvailable: boolean;
  unified?: string;
}

interface EventBase {
  id: string;
  seq: number;
  sessionId: string;
  ts: number;
  status: EventStatus;
}

export interface EditEvent extends EventBase {
  kind: "edit";
  relPath: string;
  languageId?: string;
  diff: DiffStat;
  reason?: TextEditReason;
  eol?: "\n" | "\r\n";
  searchText?: string;
}

export interface FileEvent extends EventBase {
  kind: "save" | "file-create" | "file-delete" | "file-change";
  relPath: string;
  source?: "editor" | "watcher";
}

export interface RenameEvent extends EventBase {
  kind: "file-rename";
  relPath: string;
  fromPath: string;
}

export interface TaskEvent extends EventBase {
  kind: "task";
  taskName: string;
  taskSource: string;
  taskId?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface DebugEvent extends EventBase {
  kind: "debug";
  debugName: string;
  debugType: string;
  debugSessionId: string;
  durationMs?: number;
}

export interface TerminalEvent extends EventBase {
  kind: "terminal";
  command: string;
  cwd?: string;
  exitCode?: number;
  durationMs?: number;
}

export type ActivityEvent =
  | EditEvent
  | FileEvent
  | RenameEvent
  | TaskEvent
  | DebugEvent
  | TerminalEvent;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Event content supplied by trackers; identity, time, seq and status are filled by the store. */
export type EventDraft = DistributiveOmit<
  ActivityEvent,
  "id" | "seq" | "sessionId" | "ts" | "status"
> & { status?: EventStatus };

export interface EventProgressPatch {
  status?: EventStatus;
  exitCode?: number;
  durationMs?: number;
  command?: string;
  cwd?: string;
}

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

export type LocaleSetting = "auto" | "en" | "fa";
export type ResolvedLocale = "en" | "fa";
export type Direction = "ltr" | "rtl";

export interface Settings {
  enabled: boolean;
  maxEvents: number;
  maxDiffLines: number;
  contextLines: number;
  debounceMs: number;
  persistHistory: boolean;
  trackFileOperations: boolean;
  trackExternalChanges: boolean;
  trackTasks: boolean;
  trackDebug: boolean;
  trackTerminal: boolean;
  excludeGlobs: string[];
  maxFileSizeKB: number;
  statusBar: boolean;
  locale: LocaleSetting;
  openFilesOutsideWorkspace: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  kinds: [],
  query: "",
  timeRange: "session",
};
