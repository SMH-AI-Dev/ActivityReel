import type {
  ActivityEvent,
  DiffPayload,
  Direction,
  Filters,
  ResolvedLocale,
  SessionStats,
  Settings,
  Surface,
} from "./model";

export type HostMessage =
  | {
      type: "init";
      protocol: number;
      surface: Surface;
      version: string;
      locale: ResolvedLocale;
      direction: Direction;
      settings: Settings;
      events: ActivityEvent[];
      stats: SessionStats;
      paused: boolean;
      filters: Filters;
      hasMore: boolean;
      sessionId: string;
    }
  | { type: "events"; events: ActivityEvent[]; stats: SessionStats; hasMore: boolean }
  | { type: "event-update"; event: ActivityEvent; stats: SessionStats }
  | { type: "diff"; payload: DiffPayload }
  | { type: "diff-expired"; id: string }
  | { type: "older"; events: ActivityEvent[]; hasMore: boolean }
  | { type: "state"; paused: boolean; settings: Settings }
  | { type: "filters"; filters: Filters }
  | { type: "stats"; stats: SessionStats }
  | { type: "cleared" }
  | { type: "toast"; level: "info" | "warn" | "error"; message: string };

export type WebviewMessage =
  | { type: "ready" }
  | { type: "open"; id: string }
  | { type: "requestDiff"; id: string }
  | { type: "copy"; text: string }
  | { type: "copyDiff"; id: string }
  | { type: "requestOlder"; beforeSeq: number }
  | { type: "setFilters"; filters: Filters }
  | { type: "pause"; value: boolean }
  | { type: "clear" }
  | { type: "export"; format: "json" | "markdown" }
  | { type: "openAbout" }
  | { type: "openPanel" };
