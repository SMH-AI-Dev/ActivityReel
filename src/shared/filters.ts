import type { ActivityEvent, Filters, TimeRange } from "./model";

const RANGE_MS: Record<Exclude<TimeRange, "session">, number> = {
  "5m": 5 * 60 * 1000,
  "1h": 60 * 60 * 1000,
};

export function eventSearchText(event: ActivityEvent): string {
  switch (event.kind) {
    case "edit":
      return [event.relPath, event.languageId, event.searchText].filter(Boolean).join(" ");
    case "file-rename":
      return `${event.relPath} ${event.fromPath}`;
    case "task":
      return `${event.taskName} ${event.taskSource}`;
    case "debug":
      return `${event.debugName} ${event.debugType}`;
    case "terminal":
      return [event.command, event.cwd].filter(Boolean).join(" ");
    default:
      return event.relPath;
  }
}

export function eventMatchesFilters(
  event: ActivityEvent,
  filters: Filters,
  now = Date.now(),
): boolean {
  if (filters.kinds.length > 0 && !filters.kinds.includes(event.kind)) {
    return false;
  }

  if (filters.timeRange !== "session") {
    const windowMs = RANGE_MS[filters.timeRange];
    if (event.ts < now - windowMs) {
      return false;
    }
  }

  const query = filters.query.trim().toLocaleLowerCase();
  if (query.length > 0 && !eventSearchText(event).toLocaleLowerCase().includes(query)) {
    return false;
  }

  return true;
}

export function filterActivity(
  events: readonly ActivityEvent[],
  filters: Filters,
  now = Date.now(),
): ActivityEvent[] {
  return events.filter((event) => eventMatchesFilters(event, filters, now));
}
