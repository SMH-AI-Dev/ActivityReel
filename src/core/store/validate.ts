import type {
  ActivityEvent,
  DiffHunk,
  DiffLine,
  DiffPayload,
  DiffStat,
  WordSegment,
} from "../../shared/model";
import { looksAbsolute } from "../../shared/paths";

/**
 * Structural validation for persisted state. Every function is pure, never throws and accepts
 * `unknown` input, so corrupted storage can never break activation.
 */

const EVENT_KINDS = new Set([
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

const STATUSES = new Set(["running", "done", "failed"]);

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafePath(value: unknown): value is string {
  return isNonEmptyString(value) && !looksAbsolute(value);
}

function copyOptionalNumber(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function copyOptionalString(value: unknown, maxLength?: number): string | undefined {
  if (typeof value !== "string") return undefined;
  if (maxLength !== undefined && value.length > maxLength) return value.slice(0, maxLength);
  return value;
}

function copyStat(value: unknown): DiffStat | undefined {
  if (!isObj(value)) return undefined;
  if (
    !isFiniteNumber(value.added) ||
    !isFiniteNumber(value.removed) ||
    !isFiniteNumber(value.hunks) ||
    typeof value.truncated !== "boolean"
  ) {
    return undefined;
  }
  return {
    added: Math.max(0, value.added),
    removed: Math.max(0, value.removed),
    hunks: Math.max(0, value.hunks),
    truncated: value.truncated,
  };
}

export function isEventKind(value: unknown): boolean {
  return typeof value === "string" && EVENT_KINDS.has(value);
}

/**
 * Validates and copies one event. Returns `undefined` when the shape, kind, identity fields or
 * any required payload field is invalid, or when a path looks absolute.
 */
export function sanitizeEvent(value: unknown): ActivityEvent | undefined {
  if (!isObj(value)) return undefined;
  const { id, seq, sessionId, ts, status, kind } = value;
  if (!isNonEmptyString(id)) return undefined;
  if (!isFiniteNumber(seq) || !Number.isInteger(seq) || seq < 0) return undefined;
  if (!isNonEmptyString(sessionId)) return undefined;
  if (!isFiniteNumber(ts) || ts < 0) return undefined;
  if (typeof status !== "string" || !STATUSES.has(status)) return undefined;
  if (!isEventKind(kind)) return undefined;

  const base = { id, seq, sessionId, ts, status: status as ActivityEvent["status"] };

  switch (kind) {
    case "edit": {
      if (!isSafePath(value.relPath)) return undefined;
      const stat = copyStat(value.diff);
      if (!stat) return undefined;
      const event: ActivityEvent = { ...base, kind, relPath: value.relPath, diff: stat };
      const languageId = copyOptionalString(value.languageId, 200);
      if (languageId !== undefined) event.languageId = languageId;
      if (value.reason === "undo" || value.reason === "redo") event.reason = value.reason;
      if (value.eol === "\n" || value.eol === "\r\n") event.eol = value.eol;
      const searchText = copyOptionalString(value.searchText, 400);
      if (searchText !== undefined) event.searchText = searchText;
      return event;
    }
    case "save":
    case "file-create":
    case "file-delete":
    case "file-change": {
      if (!isSafePath(value.relPath)) return undefined;
      const event: ActivityEvent = { ...base, kind, relPath: value.relPath };
      if (value.source === "editor" || value.source === "watcher") event.source = value.source;
      return event;
    }
    case "file-rename": {
      if (!isSafePath(value.relPath)) return undefined;
      if (!isSafePath(value.fromPath)) return undefined;
      return { ...base, kind, relPath: value.relPath, fromPath: value.fromPath };
    }
    case "task": {
      const taskName = copyOptionalString(value.taskName, 200);
      if (taskName === undefined) return undefined;
      const event: ActivityEvent = {
        ...base,
        kind,
        taskName,
        taskSource: copyOptionalString(value.taskSource, 200) ?? "",
      };
      const taskId = copyOptionalString(value.taskId, 200);
      if (taskId !== undefined) event.taskId = taskId;
      const exitCode = copyOptionalNumber(value.exitCode);
      if (exitCode !== undefined) event.exitCode = exitCode;
      const durationMs = copyOptionalNumber(value.durationMs);
      if (durationMs !== undefined) event.durationMs = Math.max(0, durationMs);
      return event;
    }
    case "debug": {
      const debugName = copyOptionalString(value.debugName, 200);
      const debugType = copyOptionalString(value.debugType, 200);
      const debugSessionId = copyOptionalString(value.debugSessionId, 200);
      if (debugName === undefined || debugType === undefined || debugSessionId === undefined) {
        return undefined;
      }
      const event: ActivityEvent = { ...base, kind, debugName, debugType, debugSessionId };
      const durationMs = copyOptionalNumber(value.durationMs);
      if (durationMs !== undefined) event.durationMs = Math.max(0, durationMs);
      return event;
    }
    case "terminal": {
      const command = copyOptionalString(value.command, 4000);
      if (command === undefined) return undefined;
      const event: ActivityEvent = { ...base, kind, command };
      const cwd = copyOptionalString(value.cwd, 1000);
      if (cwd !== undefined && !looksAbsolute(cwd)) event.cwd = cwd;
      const exitCode = copyOptionalNumber(value.exitCode);
      if (exitCode !== undefined) event.exitCode = exitCode;
      const durationMs = copyOptionalNumber(value.durationMs);
      if (durationMs !== undefined) event.durationMs = Math.max(0, durationMs);
      return event;
    }
    default:
      return undefined;
  }
}

function sanitizeLine(value: unknown): DiffLine | undefined {
  if (!isObj(value)) return undefined;
  const kind = value.kind;
  if (kind !== "context" && kind !== "added" && kind !== "removed") return undefined;
  if (typeof value.text !== "string") return undefined;
  const line: DiffLine = { kind, text: value.text };
  const oldLine = copyOptionalNumber(value.oldLine);
  if (oldLine !== undefined) line.oldLine = oldLine;
  const newLine = copyOptionalNumber(value.newLine);
  if (newLine !== undefined) line.newLine = newLine;
  if (Array.isArray(value.words)) {
    const words: WordSegment[] = [];
    for (const word of value.words) {
      if (!isObj(word) || typeof word.text !== "string" || typeof word.changed !== "boolean") {
        return undefined;
      }
      words.push({ text: word.text, changed: word.changed });
    }
    line.words = words;
  }
  return line;
}

function sanitizeHunk(value: unknown): DiffHunk | undefined {
  if (!isObj(value)) return undefined;
  if (typeof value.header !== "string" || !Array.isArray(value.lines)) return undefined;
  if (
    !isFiniteNumber(value.oldStart) ||
    !isFiniteNumber(value.oldLines) ||
    !isFiniteNumber(value.newStart) ||
    !isFiniteNumber(value.newLines)
  ) {
    return undefined;
  }
  const lines: DiffLine[] = [];
  for (const raw of value.lines) {
    const line = sanitizeLine(raw);
    if (!line) return undefined;
    lines.push(line);
  }
  return {
    header: value.header,
    oldStart: value.oldStart,
    oldLines: value.oldLines,
    newStart: value.newStart,
    newLines: value.newLines,
    lines,
  };
}

/** Validates and copies one diff payload; `eventId` must be provided by the caller when omitted. */
export function sanitizeDiff(value: unknown, fallbackEventId?: string): DiffPayload | undefined {
  if (!isObj(value)) return undefined;
  const eventId = isNonEmptyString(value.eventId) ? value.eventId : fallbackEventId;
  if (!eventId) return undefined;
  const stat = copyStat(value.stat);
  if (!stat) return undefined;
  if (value.mode !== "exact" && value.mode !== "coarse") return undefined;
  if (typeof value.fullAvailable !== "boolean") return undefined;
  if (!Array.isArray(value.hunks)) return undefined;
  const hunks: DiffHunk[] = [];
  for (const raw of value.hunks) {
    const hunk = sanitizeHunk(raw);
    if (!hunk) return undefined;
    hunks.push(hunk);
  }
  const payload: DiffPayload = {
    eventId,
    hunks,
    stat,
    mode: value.mode,
    fullAvailable: value.fullAvailable,
  };
  if (typeof value.unified === "string") payload.unified = value.unified;
  return payload;
}
