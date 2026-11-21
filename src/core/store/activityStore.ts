import type {
  ActivityEvent,
  DiffPayload,
  EventDraft,
  EventProgressPatch,
  SessionStats,
} from "../../shared/model";
import { DEFAULT_SETTINGS, LIMITS } from "../../shared/constants";
import { sanitizeDiff, sanitizeEvent } from "./validate";
import type { EventSink } from "./eventSink";

export interface StoreOptions {
  maxEvents?: number;
  retainedDiffs?: number;
  sessionId?: string;
  now?: () => number;
  idFactory?: () => string;
}

export interface PersistedState {
  v: 1;
  sessionId: string;
  sessionStartedAt: number;
  seq: number;
  events: ActivityEvent[];
  diffs: DiffPayload[];
}

export interface Page {
  events: ActivityEvent[];
  hasMore: boolean;
}

const STATE_VERSION = 1;
const DEFAULT_MAX_EVENTS = DEFAULT_SETTINGS.maxEvents;
const DEFAULT_RETAINED_DIFFS = LIMITS.retainedDiffEvents;
const MIN_MAX_EVENTS = LIMITS.maxEventsMin;
const MAX_MAX_EVENTS = LIMITS.maxEventsMax;

/** Kinds whose `relPath` counts toward the unique-file stat (rename uses the new path). */
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

interface EventTotals {
  added: number;
  removed: number;
  files: Set<string>;
}

function eventTotals(event: ActivityEvent): EventTotals {
  const totals: EventTotals = { added: 0, removed: 0, files: new Set<string>() };
  if (event.kind === "edit") {
    totals.added = event.diff.added;
    totals.removed = event.diff.removed;
  }
  const path = eventPath(event);
  if (path !== undefined) totals.files.add(path);
  return totals;
}

function isCrypto(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function";
}

let fallbackCounter = 0;

/** Prefers `crypto.randomUUID`; the fallback is unique within the process and ordered. */
function defaultIdFactory(): string {
  if (isCrypto()) return crypto.randomUUID();
  fallbackCounter = (fallbackCounter + 1) % Number.MAX_SAFE_INTEGER;
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${random}`;
}

function clampMaxEvents(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_MAX_EVENTS;
  const rounded = Math.floor(n);
  return Math.min(MAX_MAX_EVENTS, Math.max(MIN_MAX_EVENTS, rounded));
}

function byteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function cloneEvent(event: ActivityEvent): ActivityEvent {
  const copy = { ...event };
  if (copy.kind === "edit") copy.diff = { ...copy.diff };
  return copy;
}

/**
 * Bounded, in-memory activity log.
 *
 * Events are ordered by a monotonic `seq`; the ring buffer evicts the oldest events beyond
 * `maxEvents` and diff payloads beyond `retainedDiffs` (newest by seq). The store never holds
 * absolute paths: events whose path looks absolute are rejected on append and on load.
 */
export class ActivityStore implements EventSink {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly retainedDiffs: number;
  private maxEvents: number;
  private currentSessionId: string;
  private startedAt: number;
  private nextSeq = 1;
  private readonly events = new Map<string, ActivityEvent>();
  private readonly diffs = new Map<string, DiffPayload>();
  private added = 0;
  private removed = 0;
  private readonly files = new Set<string>();
  private currentRevision = 0;

  constructor(options: StoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.maxEvents = clampMaxEvents(options.maxEvents ?? DEFAULT_MAX_EVENTS);
    const retained = options.retainedDiffs ?? DEFAULT_RETAINED_DIFFS;
    this.retainedDiffs = Number.isFinite(retained) && retained > 0 ? Math.floor(retained) : 0;
    this.currentSessionId = options.sessionId ?? this.idFactory();
    this.startedAt = this.now();
  }

  append(draft: EventDraft): ActivityEvent {
    const ts = this.now();
    const candidateSeq = this.nextSeq;
    const base = {
      id: this.uniqueId(),
      seq: candidateSeq,
      sessionId: this.currentSessionId,
      ts,
      status: draft.status ?? "done",
    };
    const event = sanitizeEvent({ ...draft, ...base });
    if (!event) throw new Error("CodeTrail: invalid activity event draft");
    this.nextSeq = Math.max(this.nextSeq, event.seq + 1);
    this.events.set(event.id, event);
    const totals = eventTotals(event);
    this.added += totals.added;
    this.removed += totals.removed;
    for (const path of totals.files) this.files.add(path);
    this.evictEvents();
    this.currentRevision += 1;
    return cloneEvent(event);
  }

  update(id: string, patch: EventProgressPatch): ActivityEvent | undefined {
    const existing = this.events.get(id);
    if (!existing) return undefined;
    const next = { ...existing } as ActivityEvent;
    const record = next as unknown as Record<string, unknown>;
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.exitCode !== undefined) record.exitCode = patch.exitCode;
    if (patch.durationMs !== undefined) record.durationMs = patch.durationMs;
    if (patch.command !== undefined) record.command = patch.command;
    if (patch.cwd !== undefined) record.cwd = patch.cwd;
    const sanitized = sanitizeEvent(next);
    // A rejected patch must not leak the store's internal object to the caller.
    if (!sanitized) return cloneEvent(existing);
    this.events.set(id, sanitized);
    this.currentRevision += 1;
    return cloneEvent(sanitized);
  }

  attachDiff(id: string, payload: DiffPayload): void {
    if (!this.events.has(id)) return;
    const clean = sanitizeDiff(payload, id);
    if (!clean) return;
    this.diffs.delete(id);
    this.diffs.set(id, clean);
    this.evictDiffs();
    this.currentRevision += 1;
  }

  get(id: string): ActivityEvent | undefined {
    const event = this.events.get(id);
    return event ? cloneEvent(event) : undefined;
  }

  getDiff(id: string): DiffPayload | undefined {
    const payload = this.diffs.get(id);
    return payload ? structuredClone(payload) : undefined;
  }

  /** All events in ascending seq order; returned events are copies. */
  list(): ActivityEvent[] {
    return this.sorted().map(cloneEvent);
  }

  /** Newest `limit` events, returned in ascending order. */
  pageNewest(limit: number = LIMITS.feedPageSize): Page {
    const events = this.sorted();
    const size = normalizeLimit(limit);
    const start = Math.max(0, events.length - size);
    return {
      events: events.slice(start).map(cloneEvent),
      hasMore: start > 0,
    };
  }

  /** Up to `limit` events with `seq < beforeSeq`, returned in ascending order. */
  pageOlder(beforeSeq: number, limit: number = LIMITS.feedPageSize): Page {
    const size = normalizeLimit(limit);
    const older = this.sorted().filter((event) => event.seq < beforeSeq);
    const start = Math.max(0, older.length - size);
    return {
      events: older.slice(start).map(cloneEvent),
      hasMore: start > 0,
    };
  }

  stats(): SessionStats {
    return {
      events: this.events.size,
      files: this.files.size,
      added: this.added,
      removed: this.removed,
      sessionStartedAt: this.startedAt,
      durationMs: Math.max(0, this.now() - this.startedAt),
    };
  }

  setMaxEvents(n: number): void {
    this.maxEvents = clampMaxEvents(n);
    this.evictEvents();
    this.currentRevision += 1;
  }

  clear(): void {
    this.events.clear();
    this.diffs.clear();
    this.files.clear();
    this.added = 0;
    this.removed = 0;
    this.nextSeq = 1;
    this.currentSessionId = this.idFactory();
    this.startedAt = this.now();
    this.currentRevision += 1;
  }

  get sessionId(): string {
    return this.currentSessionId;
  }

  /** Monotonic counter bumped by every mutation that can change `serialize()` output. */
  get revision(): number {
    return this.currentRevision;
  }

  get seq(): number {
    return this.nextSeq - 1;
  }

  isEmpty(): boolean {
    return this.events.size === 0;
  }

  /**
   * Snapshot bounded to `LIMITS.persistMaxBytes`. Drops diffs from the oldest events first, then
   * the oldest events themselves. Events that fail `sanitizeEvent` (e.g. absolute paths) are dropped.
   */
  serialize(): PersistedState {
    const events: ActivityEvent[] = [];
    for (const event of this.sorted()) {
      const clean = sanitizeEvent(event);
      if (clean) events.push(clean);
    }
    const kept = new Set(events.map((event) => event.id));
    const diffs: DiffPayload[] = [];
    for (const event of events) {
      const payload = this.diffs.get(event.id);
      if (!payload || !kept.has(payload.eventId)) continue;
      const clean = sanitizeDiff(payload, event.id);
      if (clean) diffs.push(clean);
    }
    const state: PersistedState = {
      v: STATE_VERSION,
      sessionId: this.currentSessionId,
      sessionStartedAt: this.startedAt,
      seq: this.nextSeq - 1,
      events,
      diffs,
    };
    return fitState(state);
  }

  /**
   * Restores persisted state. Returns false (without touching memory) for newer versions or
   * non-object input; otherwise restores valid events/diffs, drops malformed entries and
   * re-applies the ring-buffer caps.
   */
  load(state: unknown): boolean {
    if (typeof state === "string") {
      try {
        return this.load(JSON.parse(state));
      } catch {
        return false;
      }
    }
    if (typeof state !== "object" || state === null || Array.isArray(state)) return false;
    const raw = state as Record<string, unknown>;
    if (raw.v !== STATE_VERSION) return false;

    const events: ActivityEvent[] = [];
    if (Array.isArray(raw.events)) {
      for (const candidate of raw.events) {
        const event = sanitizeEvent(candidate);
        if (event) events.push(event);
      }
    }
    // Deduplicate by id/seq, keeping the first occurrence in ascending seq order.
    events.sort((a, b) => a.seq - b.seq);
    const seenIds = new Set<string>();
    const seenSeqs = new Set<number>();
    const unique: ActivityEvent[] = [];
    for (const event of events) {
      if (seenIds.has(event.id) || seenSeqs.has(event.seq)) continue;
      seenIds.add(event.id);
      seenSeqs.add(event.seq);
      unique.push(event);
    }

    const sessionId =
      typeof raw.sessionId === "string" && raw.sessionId.length > 0
        ? raw.sessionId
        : this.currentSessionId;
    const startedAt =
      typeof raw.sessionStartedAt === "number" && Number.isFinite(raw.sessionStartedAt)
        ? raw.sessionStartedAt
        : this.startedAt;

    const diffs = new Map<string, DiffPayload>();
    if (Array.isArray(raw.diffs)) {
      for (const candidate of raw.diffs) {
        const payload = sanitizeDiff(candidate);
        if (!payload || !seenIds.has(payload.eventId)) continue;
        diffs.set(payload.eventId, payload);
      }
    }

    this.events.clear();
    this.diffs.clear();
    this.files.clear();
    this.added = 0;
    this.removed = 0;
    this.currentSessionId = sessionId;
    this.startedAt = startedAt;
    const maxSeq = unique.reduce((max, event) => Math.max(max, event.seq), 0);
    const rawSeq =
      typeof raw.seq === "number" && Number.isFinite(raw.seq) && raw.seq >= 0
        ? Math.floor(raw.seq)
        : 0;
    this.nextSeq = Math.max(rawSeq, maxSeq) + 1;

    for (const event of unique) {
      this.events.set(event.id, event);
      const totals = eventTotals(event);
      this.added += totals.added;
      this.removed += totals.removed;
      for (const path of totals.files) this.files.add(path);
      const payload = diffs.get(event.id);
      if (payload) this.diffs.set(event.id, payload);
    }
    this.evictEvents();
    this.evictDiffs();
    this.currentRevision += 1;
    return true;
  }

  private uniqueId(): string {
    let id = this.idFactory();
    let guard = 0;
    while (this.events.has(id) && guard < 100) {
      id = this.idFactory();
      guard += 1;
    }
    return id;
  }

  private sorted(): ActivityEvent[] {
    return [...this.events.values()].sort((a, b) => a.seq - b.seq);
  }

  private evictEvents(): void {
    if (this.events.size <= this.maxEvents) return;
    const ordered = this.sorted();
    const excess = ordered.length - this.maxEvents;
    for (let i = 0; i < excess; i += 1) {
      const event = ordered[i];
      if (!event) continue;
      if (!this.events.delete(event.id)) continue;
      this.diffs.delete(event.id);
      const totals = eventTotals(event);
      this.added = Math.max(0, this.added - totals.added);
      this.removed = Math.max(0, this.removed - totals.removed);
      const path = eventPath(event);
      if (path && !this.sorted().some((other) => eventPath(other) === path)) {
        this.files.delete(path);
      }
    }
  }

  private evictDiffs(): void {
    if (this.diffs.size <= this.retainedDiffs) return;
    const ordered = this.sorted();
    const excess = this.diffs.size - this.retainedDiffs;
    let removed = 0;
    for (const event of ordered) {
      if (removed >= excess) break;
      if (this.diffs.delete(event.id)) removed += 1;
    }
  }
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.floor(limit);
}

function stateBytes(state: PersistedState): number {
  return byteLength(JSON.stringify(state));
}

/**
 * Shrinks `state` in place until it fits `LIMITS.persistMaxBytes`: first drops diffs from the
 * oldest events, then the oldest events themselves. The output is always valid JSON.
 */
function fitState(state: PersistedState): PersistedState {
  let total = stateBytes(state);
  if (total <= LIMITS.persistMaxBytes) return state;
  // Array elements are serialized in order, so measuring incrementally keeps this O(size).
  const diffBytes = state.diffs.map((diff) => byteLength(JSON.stringify(diff)) + 1);
  while (state.diffs.length > 0 && total > LIMITS.persistMaxBytes) {
    total -= diffBytes.shift() ?? 0;
    state.diffs.shift();
  }
  if (total <= LIMITS.persistMaxBytes) return state;
  const eventBytes = state.events.map((event) => byteLength(JSON.stringify(event)) + 1);
  while (state.events.length > 0 && total > LIMITS.persistMaxBytes) {
    total -= eventBytes.shift() ?? 0;
    state.events.shift();
  }
  return state;
}
