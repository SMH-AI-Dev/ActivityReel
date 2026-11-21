import type { ActivityEvent, EventKind, TimeRange } from "../../../src/shared/model";
import type { AppState } from "./store";

const RANGE_MS: Record<Exclude<TimeRange, "session">, number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
};

const KIND_GROUPS: Record<string, readonly EventKind[]> = {
  edit: ["edit"],
  files: ["save", "file-create", "file-delete", "file-rename", "file-change"],
  tasks: ["task"],
  debug: ["debug"],
  exec: ["terminal"],
};

export function kindsInGroup(key: string): readonly EventKind[] {
  return KIND_GROUPS[key] ?? [];
}

/** Case-insensitive haystack for an event: paths, task/command/debug names, search text. */
export function eventHaystack(event: ActivityEvent): string {
  switch (event.kind) {
    case "edit":
      return `${event.relPath}\n${event.searchText ?? ""}`;
    case "file-rename":
      return `${event.relPath}\n${event.fromPath}`;
    case "task":
      return `${event.taskName}\n${event.taskSource}`;
    case "debug":
      return `${event.debugName}\n${event.debugType}`;
    case "terminal":
      return `${event.command}\n${event.cwd ?? ""}`;
    default:
      return event.relPath;
  }
}

export interface FilterContext {
  kinds: EventKind[];
  queryLower: string;
  range: TimeRange;
  now: number;
}

export function matchesFilters(event: ActivityEvent, ctx: FilterContext): boolean {
  if (ctx.kinds.length > 0 && !ctx.kinds.includes(event.kind)) return false;
  if (ctx.range !== "session") {
    const cutoff = ctx.now - RANGE_MS[ctx.range];
    if (event.ts < cutoff) return false;
  }
  if (ctx.queryLower) {
    if (!eventHaystack(event).toLowerCase().includes(ctx.queryLower)) return false;
  }
  return true;
}

export function hasActiveFilters(state: AppState): boolean {
  return state.filters.kinds.length > 0 || state.filters.query.trim().length > 0 || state.filters.timeRange !== "session";
}

export function selectVisibleEvents(state: AppState, now: number): ActivityEvent[] {
  const { filters } = state;
  const queryLower = filters.query.trim().toLowerCase();
  if (filters.kinds.length === 0 && !queryLower && filters.timeRange === "session") {
    return state.events;
  }
  const ctx: FilterContext = { kinds: filters.kinds, queryLower, range: filters.timeRange, now };
  return state.events.filter((event) => matchesFilters(event, ctx));
}
