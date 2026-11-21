import type {
  ActivityEvent,
  DiffHunk,
  DiffPayload,
  SessionStats,
  Settings,
} from "../../shared/model";
import { looksAbsolute } from "../../shared/paths";

/**
 * Pure JSON/Markdown exporters. Everything is deterministic given a `bundle`; no VS Code or Node
 * APIs are used. Output is capped at 5 MB.
 *
 * Before export the bundle is classified: events whose path, renamed-from path or terminal cwd
 * looks absolute are omitted entirely (a path without its root is not a truthful pointer). Diff
 * text is only ever emitted as a content block, so paths inside a unified diff cannot leak a
 * machine location as a link or heading.
 */

export interface ExportMeta {
  exportedAt: number;
  extensionVersion: string;
  settings: Settings;
  sessionId: string;
}

export interface ExportBundle {
  events: ActivityEvent[];
  stats: SessionStats;
  diffs: Record<string, DiffPayload>;
  meta: ExportMeta;
}

export const EXPORT_SCHEMA_VERSION = 1;
export const EXPORT_MAX_BYTES = 5 * 1024 * 1024;
export const EXPORT_TRUNCATED_MARKER = "… [export truncated: size limit reached]";

const KIND_LABELS: Record<ActivityEvent["kind"], string> = {
  edit: "Edit",
  save: "Save",
  "file-create": "File created",
  "file-delete": "File deleted",
  "file-rename": "File renamed",
  "file-change": "File changed (on disk)",
  task: "Task",
  debug: "Debug",
  terminal: "Terminal",
};

export function kindLabel(kind: ActivityEvent["kind"]): string {
  return KIND_LABELS[kind];
}

/** Settings are not secret, but only known keys are exported (no future user content). */
const SETTINGS_KEYS: ReadonlyArray<keyof Settings> = [
  "enabled",
  "maxEvents",
  "maxDiffLines",
  "contextLines",
  "debounceMs",
  "persistHistory",
  "trackFileOperations",
  "trackExternalChanges",
  "trackTasks",
  "trackDebug",
  "trackTerminal",
  "excludeGlobs",
  "maxFileSizeKB",
  "statusBar",
  "locale",
  "openFilesOutsideWorkspace",
];

function publicSettings(settings: Settings): Settings {
  const result: Record<string, unknown> = {};
  for (const key of SETTINGS_KEYS) result[key] = settings[key];
  return result as unknown as Settings;
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function sanitizedStats(stats: SessionStats): SessionStats {
  return {
    events: finiteNonNegative(stats.events),
    files: finiteNonNegative(stats.files),
    added: finiteNonNegative(stats.added),
    removed: finiteNonNegative(stats.removed),
    sessionStartedAt: finiteNonNegative(stats.sessionStartedAt),
    durationMs: finiteNonNegative(stats.durationMs),
  };
}

function eventPath(event: ActivityEvent): string | undefined {
  switch (event.kind) {
    case "edit":
    case "save":
    case "file-create":
    case "file-delete":
    case "file-change":
    case "file-rename":
      return event.relPath;
    default:
      return undefined;
  }
}

function eventName(event: ActivityEvent): string {
  switch (event.kind) {
    case "task":
      return event.taskName;
    case "debug":
      return event.debugName;
    case "terminal":
      return event.command || "(command)";
    default:
      return eventPath(event) ?? "";
  }
}

/** Path-like fields of an event that must not be absolute. */
function eventPointers(event: ActivityEvent): string[] {
  const pointers: string[] = [];
  const path = eventPath(event);
  if (path !== undefined) pointers.push(path);
  if (event.kind === "file-rename") pointers.push(event.fromPath);
  if (event.kind === "terminal" && event.cwd !== undefined) pointers.push(event.cwd);
  return pointers;
}

interface Classified {
  events: ActivityEvent[];
  diffs: DiffPayload[];
  omitted: number;
}

function classify(bundle: ExportBundle): Classified {
  const events: ActivityEvent[] = [];
  const included = new Set<string>();
  let omitted = 0;
  for (const event of bundle.events) {
    const pointers = eventPointers(event);
    const pointerCount = pointers.length;
    const safe = pointers.every((pointer) => !looksAbsolute(pointer));
    if (!safe) omitted += 1;
    // Events without any path-like pointer (task/debug) have nothing to leak.
    if (safe || pointerCount === 0) {
      events.push(event);
      included.add(event.id);
    }
  }
  const diffs: DiffPayload[] = [];
  for (const payload of Object.values(bundle.diffs)) {
    if (included.has(payload.eventId)) diffs.push(payload);
  }
  return { events, diffs, omitted };
}

function capText(text: string, limit: number): string {
  if (Buffer.byteLength(text, "utf8") <= limit) return text;
  const marker = `\n${EXPORT_TRUNCATED_MARKER}\n`;
  const budget = Math.max(0, limit - Buffer.byteLength(marker, "utf8"));
  // The byte budget is always <= the char budget, so this is a safe upper bound. A binary
  // search over char prefixes avoids trimming a multi-megabyte string one character at a time.
  let lo = 0;
  let hi = Math.min(text.length, budget);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(text.slice(0, mid), "utf8") <= budget) lo = mid;
    else hi = mid - 1;
  }
  let cut = text.slice(0, lo);
  // Never split a surrogate pair.
  const last = cut.charCodeAt(cut.length - 1);
  if (cut.length > 0 && last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}${marker}`;
}

/** JSON export: pretty 2-space, newest-first events, diffs as an array sorted by event id. */
export function exportJson(bundle: ExportBundle): string {
  const { events, diffs, omitted } = classify(bundle);
  const sortedEvents = [...events].sort((a, b) => b.seq - a.seq);
  const document: Record<string, unknown> = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date(bundle.meta.exportedAt).toISOString(),
    extensionVersion: bundle.meta.extensionVersion,
    sessionId: bundle.meta.sessionId,
    settings: publicSettings(bundle.meta.settings),
    stats: sanitizedStats(bundle.stats),
    events: sortedEvents,
    diffs: diffs
      .map((payload) => {
        const entry: Record<string, unknown> = {
          eventId: payload.eventId,
          stat: payload.stat,
          mode: payload.mode,
          fullAvailable: payload.fullAvailable,
          hunks: payload.hunks,
        };
        if (payload.unified !== undefined) entry.unified = payload.unified;
        return entry;
      })
      .sort((a, b) => String(a.eventId).localeCompare(String(b.eventId))),
    omittedForPrivacy: omitted,
  };
  return capText(`${JSON.stringify(document, null, 2)}\n`, EXPORT_MAX_BYTES);
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function clockTime(ts: number): string {
  const date = new Date(ts);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function localDateTime(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clockTime(ts)}`;
}

function dayHeading(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const HEADING_SPECIAL = /([\\`*_[\]<>#|~])/g;

/** Escapes characters that would change heading/table/link meaning in paths and names. */
function escapeMarkdownText(text: string): string {
  return text.replace(HEADING_SPECIAL, "\\$1");
}

/** Escapes backticks and backslashes so inline code spans stay intact. */
function escapeInlineCode(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
}

/** Chooses `~~~` when the content contains a backtick fence, otherwise ```. */
function fenced(content: string, language = "diff"): string {
  const fence = content.includes("```") ? "~~~" : "```";
  const body = content.endsWith("\n") ? content : `${content}\n`;
  return `${fence}${language}\n${body}${fence}\n`;
}

function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function diffStatLine(event: ActivityEvent, retained: DiffPayload | undefined): string | undefined {
  if (event.kind === "edit") return `+${event.diff.added}/−${event.diff.removed}`;
  if (retained && (event.kind === "save" || event.kind === "file-change")) {
    return `+${retained.stat.added}/−${retained.stat.removed}`;
  }
  return undefined;
}

function hunkText(hunk: DiffHunk): string {
  const body = [hunk.header];
  for (const line of hunk.lines) {
    const prefix = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
    body.push(`${prefix}${line.text}`);
  }
  return body.join("\n");
}

/** Diff body plus honest notes when the payload is missing, coarse, truncated or expired. */
function diffSection(event: ActivityEvent, payload: DiffPayload | undefined): string[] {
  if (event.kind !== "edit" && event.kind !== "save" && event.kind !== "file-change") return [];
  if (!payload) {
    if (event.kind === "edit") {
      return ["_Diff no longer retained (evicted from the retained window)._", ""];
    }
    return [];
  }
  const lines: string[] = [];
  if (payload.mode === "coarse") {
    lines.push(
      "_Coarse diff: the change was too large for a line-level diff and is shown as a replaced block._",
      "",
    );
  }
  const truncated = payload.stat.truncated || !payload.fullAvailable;
  if (truncated) {
    lines.push(`_Diff truncated${payload.fullAvailable ? "" : " (only part of the change was retained)"}._`, "");
  }
  if (payload.hunks.length === 0 && !payload.unified) {
    lines.push("_Diff no longer retained or unavailable for this change._", "");
    return lines;
  }
  if (payload.unified && payload.unified.trim().length > 0) {
    lines.push(fenced(payload.unified));
  } else {
    for (const hunk of payload.hunks) lines.push(fenced(hunkText(hunk)));
  }
  return lines;
}

/** Markdown export: newest-first, one heading per event with details and fenced diffs. */
export function exportMarkdown(bundle: ExportBundle): string {
  const { events, diffs, omitted } = classify(bundle);
  const retained = new Map(diffs.map((payload) => [payload.eventId, payload]));
  const stats = sanitizedStats(bundle.stats);
  const parts: string[] = [];

  parts.push("# CodeTrail activity export", "");
  parts.push(`Exported: ${localDateTime(bundle.meta.exportedAt)}`);
  parts.push(
    `Session: \`${escapeInlineCode(bundle.meta.sessionId)}\` · CodeTrail ${escapeInlineCode(
      bundle.meta.extensionVersion,
    )}`,
  );
  parts.push(
    `Stats: ${stats.events} events · ${stats.files} files · +${stats.added}/−${stats.removed} · duration ${formatDuration(stats.durationMs) ?? "0 ms"}`,
  );
  parts.push("");
  if (omitted > 0) {
    parts.push(
      `_${omitted} event${omitted === 1 ? "" : "s"} with an absolute path omitted for privacy._`,
      "",
    );
  }
  if (events.length === 0) {
    parts.push("_No activity recorded in this session._", "");
  }

  const newestFirst = [...events].sort((a, b) => b.seq - a.seq);
  let currentDay: string | undefined;
  for (const event of newestFirst) {
    const day = dayHeading(event.ts);
    if (day !== currentDay) {
      currentDay = day;
      parts.push(`## ${day}`, "");
    }
    const path = eventPath(event);
    const baseName = path ? path.split("/").pop() || path : eventName(event);
    parts.push(`### ${kindLabel(event.kind)} · ${escapeMarkdownText(baseName)} · ${clockTime(event.ts)}`, "");

    if (path) parts.push(`- Path: \`${escapeInlineCode(path)}\``);
    if (event.kind === "file-rename") parts.push(`- From: \`${escapeInlineCode(event.fromPath)}\``);
    if (event.kind === "terminal" && event.cwd) {
      parts.push(`- Directory: \`${escapeInlineCode(event.cwd)}\``);
    }
    const statLine = diffStatLine(event, retained.get(event.id));
    if (statLine) parts.push(`- Changes: ${statLine}`);
    if (event.status !== "done") parts.push(`- Status: ${event.status}`);
    if (event.kind === "edit" && event.reason) parts.push(`- Reason: ${event.reason}`);
    if ((event.kind === "task" || event.kind === "terminal") && event.exitCode !== undefined) {
      parts.push(`- Exit code: ${event.exitCode}`);
    }
    const durationMs =
      "durationMs" in event && typeof event.durationMs === "number" ? event.durationMs : undefined;
    const duration = formatDuration(durationMs);
    if (duration) parts.push(`- Duration: ${duration}`);
    if (event.kind === "task") parts.push(`- Task source: ${escapeInlineCode(event.taskSource)}`);
    if (event.kind === "terminal") parts.push(`- Command: \`${escapeInlineCode(event.command)}\``);
    if (event.kind === "debug") parts.push(`- Debug type: ${escapeInlineCode(event.debugType)}`);

    const section = diffSection(event, retained.get(event.id));
    if (section.length > 0) parts.push("", ...section);
    parts.push("");
  }

  return capText(`${parts.join("\n").trimEnd()}\n`, EXPORT_MAX_BYTES);
}
