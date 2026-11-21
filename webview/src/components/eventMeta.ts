/** Kind → label key, rail tone and icon. Rails are never colour-only: icons + words accompany. */
import type { ActivityEvent, DiffStat, EventKind } from "../../../src/shared/model";
import type { MessageKey } from "../i18n";

export type RailTone = "mod" | "add" | "del" | "ren" | "blue" | "green" | "orange" | "purple" | "red" | "yellow";

export interface KindMeta {
  labelKey: MessageKey;
  rail: string;
}

export const KIND_META: Record<EventKind, KindMeta> = {
  edit: { labelKey: "event.edit", rail: "var(--lp-mod)" },
  save: { labelKey: "event.save", rail: "var(--lp-chart-blue)" },
  "file-create": { labelKey: "event.file-create", rail: "var(--lp-add)" },
  "file-delete": { labelKey: "event.file-delete", rail: "var(--lp-del)" },
  "file-rename": { labelKey: "event.file-rename", rail: "var(--lp-ren)" },
  "file-change": { labelKey: "event.file-change", rail: "var(--lp-chart-yellow)" },
  task: { labelKey: "event.task", rail: "var(--lp-chart-green)" },
  debug: { labelKey: "event.debug", rail: "var(--lp-chart-orange)" },
  terminal: { labelKey: "event.terminal", rail: "var(--lp-chart-purple)" },
};

export function railFor(event: ActivityEvent): string {
  if (event.kind === "task" && (event.status === "failed" || (event.exitCode ?? 0) !== 0)) {
    return "var(--lp-chart-red)";
  }
  if (event.kind === "task" && event.status === "running") return "var(--lp-chart-yellow)";
  if (event.kind === "terminal" && event.status === "failed") return "var(--lp-chart-red)";
  return KIND_META[event.kind].rail;
}

export interface DisplayInfo {
  /** Primary line: path for file events, name for tasks/debug, command for terminal. */
  title: string;
  /** Secondary line for rename/terminal contexts. */
  sub?: string;
  language?: string;
  diff?: DiffStat;
  /** False for save/file events (no diff fetch). */
  expandable: boolean;
}

export function displayInfo(event: ActivityEvent): DisplayInfo {
  switch (event.kind) {
    case "edit":
      return {
        title: event.relPath,
        language: event.languageId,
        diff: event.diff,
        expandable: true,
      };
    case "file-create":
      return {
        title: event.relPath,
        diff: { added: 0, removed: 0, hunks: 0, truncated: false },
        expandable: false,
      };
    case "file-rename":
      return { title: event.relPath, sub: event.fromPath, expandable: false };
    case "task":
      return { title: event.taskName, expandable: false };
    case "debug":
      return { title: event.debugName, sub: event.debugType, expandable: false };
    case "terminal":
      return { title: event.command, sub: event.cwd, expandable: false };
    default:
      return { title: event.relPath, expandable: false };
  }
}

export function isExpandable(event: ActivityEvent): boolean {
  return event.kind === "edit";
}

export function statusLabelKey(event: ActivityEvent): MessageKey | undefined {
  switch (event.status) {
    case "running":
      return "event.running";
    case "failed":
      return "event.failed";
    case "done":
      return event.kind === "debug" ? "event.terminated" : undefined;
    default:
      return undefined;
  }
}
