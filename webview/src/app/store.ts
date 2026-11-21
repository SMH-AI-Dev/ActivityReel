/**
 * Single reducer-based store for the webview. Events are kept newest-first; diffs, expansion,
 * filters and transient UI state live next to them. Stat updates are intentionally stored apart
 * from the event list so counters can re-render without touching the feed.
 */
import type {
  ActivityEvent,
  DiffPayload,
  Direction,
  EventKind,
  Filters,
  ResolvedLocale,
  SessionStats,
  Settings,
  Surface,
} from "../../../src/shared/model";
import { DEFAULT_FILTERS } from "../../../src/shared/model";
import { DEFAULT_SETTINGS, LIMITS, PROTOCOL_VERSION } from "../../../src/shared/constants";
import type { HostMessage } from "../../../src/shared/protocol";

export type ToastLevel = "info" | "warn" | "error";

export interface ToastState {
  id: number;
  level: ToastLevel;
  message: string;
  /** Set when the toast was produced locally (preview) so it can auto-dismiss. */
  local?: boolean;
}

export interface AppState {
  /** True once `init` has been applied (before that we render skeletons). */
  initialized: boolean;
  surface: Surface;
  version: string;
  protocol: number;
  locale: ResolvedLocale;
  direction: Direction;
  sessionId: string;
  settings: Settings;
  stats: SessionStats;
  /** Newest first (seq descending). */
  events: ActivityEvent[];
  hasMore: boolean;
  olderPending: boolean;
  paused: boolean;
  filters: Filters;
  diffs: Record<string, DiffPayload>;
  pendingDiffIds: string[];
  failedDiffIds: string[];
  expiredDiffIds: string[];
  expanded: string[];
  /** Newest known seq — used to key "activity while scrolled away". */
  latestSeq: number;
  /** Seq of the newest event the user has seen while at the top, or -1. */
  seenSeqAtTop: number;
  scrolledAway: boolean;
  newActivityCount: number;
  toast: ToastState | null;
  filterPanelOpen: boolean;
  /** Restored scroll anchor (pixels in the preview DOM / row index in the virtual list). */
  scrollAnchor: number;
  justCleared: boolean;
}

export type Action =
  | { type: "host"; message: HostMessage }
  | { type: "setQuery"; query: string }
  | { type: "toggleKind"; kind: EventKind }
  | { type: "setKinds"; kinds: EventKind[] }
  | { type: "clearKinds" }
  | { type: "setTimeRange"; timeRange: Filters["timeRange"] }
  | { type: "clearFilters" }
  | { type: "setFilterPanelOpen"; open: boolean }
  | { type: "expand"; id: string }
  | { type: "collapse"; id: string }
  | { type: "expandAll"; ids: string[] }
  | { type: "setDiffPending"; id: string; pending: boolean }
  | { type: "diffFailed"; id: string }
  | { type: "diffExpired"; id: string }
  | { type: "olderRequested" }
  | { type: "olderTimeout" }
  | { type: "scrolledAway"; value: boolean }
  | { type: "newActivityVisible" }
  | { type: "showToast"; level: ToastLevel; message: string; local?: boolean }
  | { type: "toastShown"; id: number }
  | { type: "dismissToast" }
  | { type: "setScrollAnchor"; anchor: number }
  | { type: "clearReset" };

const EMPTY_STATS: SessionStats = {
  events: 0,
  files: 0,
  added: 0,
  removed: 0,
  sessionStartedAt: 0,
  durationMs: 0,
};

export const initialState: AppState = {
  initialized: false,
  surface: "panel",
  version: "",
  protocol: PROTOCOL_VERSION,
  locale: "en",
  direction: "ltr",
  sessionId: "",
  settings: DEFAULT_SETTINGS,
  stats: EMPTY_STATS,
  events: [],
  hasMore: false,
  olderPending: false,
  paused: false,
  filters: { ...DEFAULT_FILTERS, kinds: [] },
  diffs: {},
  pendingDiffIds: [],
  failedDiffIds: [],
  expiredDiffIds: [],
  expanded: [],
  latestSeq: -1,
  seenSeqAtTop: -1,
  scrolledAway: false,
  newActivityCount: 0,
  toast: null,
  filterPanelOpen: false,
  scrollAnchor: 0,
  justCleared: false,
};

export const MAX_QUERY = 200;

export function normalizeQuery(query: string): string {
  return query.slice(0, MAX_QUERY);
}

/** Merge events newest-first, dedupe by id, keep the cap. New events bump `latestSeq`. */
function mergeNewest(
  prev: ActivityEvent[],
  incoming: ActivityEvent[],
  max: number,
): { events: ActivityEvent[]; added: number } {
  if (incoming.length === 0) return { events: prev, added: 0 };
  const known = new Set(prev.map((e) => e.id));
  const fresh = incoming.filter((e) => !known.has(e.id));
  if (fresh.length === 0) return { events: prev, added: 0 };
  const merged = [...fresh, ...prev];
  merged.sort((a, b) => b.seq - a.seq);
  return { events: merged.slice(0, Math.max(100, max)), added: fresh.length };
}

function appendOldest(prev: ActivityEvent[], incoming: ActivityEvent[]): ActivityEvent[] {
  if (incoming.length === 0) return prev;
  const known = new Set(prev.map((e) => e.id));
  const fresh = incoming.filter((e) => !known.has(e.id));
  if (fresh.length === 0) return prev;
  return [...prev, ...fresh].sort((a, b) => b.seq - a.seq);
}

function replaceEvent(prev: ActivityEvent[], next: ActivityEvent): ActivityEvent[] {
  let found = false;
  const out = prev.map((e) => {
    if (e.id !== next.id) return e;
    found = true;
    return next;
  });
  return found ? out : prev;
}

function pruneOrdered(list: string[], keep: (id: string) => boolean): string[] {
  const filtered = list.filter(keep);
  return filtered.length === list.length ? list : filtered;
}

function dropIds(record: Record<string, DiffPayload>, ids: Set<string>): Record<string, DiffPayload> {
  if (ids.size === 0) return record;
  let changed = false;
  const out: Record<string, DiffPayload> = {};
  for (const [id, payload] of Object.entries(record)) {
    if (ids.has(id)) changed = true;
    else out[id] = payload;
  }
  return changed ? out : record;
}

function applyInit(state: AppState, message: Extract<HostMessage, { type: "init" }>): AppState {
  const events = [...message.events].sort((a, b) => b.seq - a.seq);
  const latestSeq = events.length > 0 ? events[0].seq : -1;
  return {
    ...state,
    initialized: true,
    surface: message.surface,
    version: message.version,
    protocol: message.protocol,
    locale: message.locale,
    direction: message.direction,
    sessionId: message.sessionId,
    settings: message.settings,
    stats: message.stats,
    events,
    hasMore: message.hasMore,
    paused: message.paused,
    filters: message.filters,
    latestSeq,
    seenSeqAtTop: latestSeq,
    scrolledAway: false,
    newActivityCount: 0,
    justCleared: false,
    expanded: state.expanded.filter((id) => events.some((e) => e.id === id)),
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "host":
      return hostReducer(state, action.message);
    case "setQuery": {
      const query = normalizeQuery(action.query);
      if (query === state.filters.query) return state;
      return { ...state, filters: { ...state.filters, query } };
    }
    case "toggleKind": {
      const has = state.filters.kinds.includes(action.kind);
      const kinds = has ? state.filters.kinds.filter((k) => k !== action.kind) : [...state.filters.kinds, action.kind];
      return { ...state, filters: { ...state.filters, kinds } };
    }
    case "setKinds": {
      const same =
        action.kinds.length === state.filters.kinds.length &&
        action.kinds.every((k, i) => k === state.filters.kinds[i]);
      return same ? state : { ...state, filters: { ...state.filters, kinds: action.kinds } };
    }
    case "clearKinds":
      return state.filters.kinds.length === 0
        ? state
        : { ...state, filters: { ...state.filters, kinds: [] } };
    case "setTimeRange":
      return { ...state, filters: { ...state.filters, timeRange: action.timeRange } };
    case "clearFilters":
      return { ...state, filters: { kinds: [], query: "", timeRange: "session" } };
    case "setFilterPanelOpen":
      return state.filterPanelOpen === action.open ? state : { ...state, filterPanelOpen: action.open };
    case "expand":
      return state.expanded.includes(action.id)
        ? state
        : { ...state, expanded: [...state.expanded, action.id] };
    case "collapse":
      return state.expanded.includes(action.id)
        ? { ...state, expanded: state.expanded.filter((id) => id !== action.id) }
        : state;
    case "expandAll": {
      const merged = new Set(state.expanded);
      for (const id of action.ids) merged.add(id);
      return { ...state, expanded: [...merged] };
    }
    case "setDiffPending": {
      if (action.pending) {
        if (state.pendingDiffIds.includes(action.id)) return state;
        return {
          ...state,
          pendingDiffIds: [...state.pendingDiffIds, action.id],
          failedDiffIds: state.failedDiffIds.filter((id) => id !== action.id),
        };
      }
      return state.pendingDiffIds.includes(action.id)
        ? { ...state, pendingDiffIds: state.pendingDiffIds.filter((id) => id !== action.id) }
        : state;
    }
    case "diffFailed":
      return {
        ...state,
        pendingDiffIds: state.pendingDiffIds.filter((id) => id !== action.id),
        failedDiffIds: state.failedDiffIds.includes(action.id)
          ? state.failedDiffIds
          : [...state.failedDiffIds, action.id],
      };
    case "diffExpired":
      return {
        ...state,
        expanded: state.expanded.filter((id) => id !== action.id),
        pendingDiffIds: state.pendingDiffIds.filter((id) => id !== action.id),
        expiredDiffIds: state.expiredDiffIds.includes(action.id)
          ? state.expiredDiffIds
          : [...state.expiredDiffIds, action.id],
      };
    case "olderRequested":
      return state.olderPending || !state.hasMore ? state : { ...state, olderPending: true };
    case "olderTimeout":
      return state.olderPending ? { ...state, olderPending: false } : state;
    case "scrolledAway":
      if (state.scrolledAway === action.value) return state;
      return {
        ...state,
        scrolledAway: action.value,
        newActivityCount: 0,
        seenSeqAtTop: action.value ? state.seenSeqAtTop : state.latestSeq,
      };
    case "newActivityVisible":
      return state.newActivityCount === 0 ? state : { ...state, newActivityCount: 0 };
    case "showToast":
      return {
        ...state,
        toast: { id: (state.toast?.id ?? 0) + 1, level: action.level, message: action.message, local: action.local },
      };
    case "toastShown":
      if (!state.toast || state.toast.id !== action.id || state.toast.local) return state;
      return { ...state, toast: { ...state.toast, local: true } };
    case "dismissToast":
      return state.toast ? { ...state, toast: null } : state;
    case "setScrollAnchor":
      return state.scrollAnchor === action.anchor ? state : { ...state, scrollAnchor: action.anchor };
    case "clearReset":
      return {
        ...state,
        events: [],
        diffs: {},
        pendingDiffIds: [],
        failedDiffIds: [],
        expiredDiffIds: [],
        expanded: [],
        hasMore: false,
        olderPending: false,
        latestSeq: -1,
        seenSeqAtTop: -1,
        newActivityCount: 0,
        justCleared: true,
      };
    default:
      return state;
  }
}

function hostReducer(state: AppState, message: HostMessage): AppState {
  switch (message.type) {
    case "init":
      return applyInit({ ...state, toast: null }, message);
    case "events": {
      const cap = state.settings.maxEvents || LIMITS.maxEventsMax;
      const { events, added } = mergeNewest(state.events, message.events, cap);
      let latestSeq = state.latestSeq;
      for (const e of message.events) if (e.seq > latestSeq) latestSeq = e.seq;
      const countNew = state.scrolledAway ? state.newActivityCount + added : 0;
      const keep = new Set(events.map((e) => e.id));
      return {
        ...state,
        events,
        stats: message.stats,
        hasMore: message.hasMore,
        latestSeq,
        newActivityCount: countNew,
        diffs: dropIds(state.diffs, new Set(Object.keys(state.diffs).filter((id) => !keep.has(id)))),
        expanded: pruneOrdered(state.expanded, (id) => keep.has(id)),
      };
    }
    case "event-update": {
      const events = replaceEvent(state.events, message.event);
      const latestSeq = Math.max(state.latestSeq, message.event.seq);
      return { ...state, events, stats: message.stats, latestSeq };
    }
    case "diff": {
      const { payload } = message;
      return {
        ...state,
        diffs: { ...state.diffs, [payload.eventId]: payload },
        pendingDiffIds: state.pendingDiffIds.filter((id) => id !== payload.eventId),
        failedDiffIds: state.failedDiffIds.filter((id) => id !== payload.eventId),
      };
    }
    case "diff-expired":
      return reducer(state, { type: "diffExpired", id: message.id });
    case "older":
      return {
        ...state,
        events: appendOldest(state.events, message.events),
        hasMore: message.hasMore,
        olderPending: false,
      };
    case "state":
      return { ...state, paused: message.paused, settings: message.settings };
    case "filters":
      return { ...state, filters: message.filters };
    case "stats":
      return { ...state, stats: message.stats };
    case "cleared":
      return reducer({ ...state, toast: null }, { type: "clearReset" });
    case "toast":
      return {
        ...state,
        toast: { id: (state.toast?.id ?? 0) + 1, level: message.level, message: message.message },
      };
    default:
      return state;
  }
}
