import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityStore } from "../../src/core/store/activityStore";
import type { PersistedState } from "../../src/core/store/activityStore";
import { HistoryPersistence } from "../../src/core/store/historyPersistence";
import type { StorageAdapter } from "../../src/core/store/historyPersistence";
import type { ActivityEvent, DiffPayload, EventDraft } from "../../src/shared/model";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FakeAdapter extends StorageAdapter {
  writes: string[];
  reads: number;
  removes: number;
  quarantines: number;
  stored: string | undefined;
}

function makeAdapter(initial?: string): FakeAdapter {
  const adapter: FakeAdapter = {
    writes: [],
    reads: 0,
    removes: 0,
    quarantines: 0,
    stored: initial,
    read: async () => {
      adapter.reads += 1;
      return adapter.stored;
    },
    write: async (text: string) => {
      adapter.writes.push(text);
      adapter.stored = text;
    },
    remove: async () => {
      adapter.removes += 1;
      adapter.stored = undefined;
    },
    quarantine: async () => {
      adapter.quarantines += 1;
    },
  };
  return adapter;
}

let idCounter = 0;

function makeStore(sessionId = "session-a"): ActivityStore {
  let clock = 1_000;
  return new ActivityStore({
    sessionId,
    now: () => (clock += 10),
    idFactory: () => `id-${(idCounter += 1)}`,
  });
}

const EDIT: EventDraft = {
  kind: "edit",
  relPath: "src/a.ts",
  diff: { added: 1, removed: 1, hunks: 1, truncated: false },
};

function persistedJSON(events: unknown[], overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    v: 1,
    sessionId: "old",
    sessionStartedAt: 5,
    seq: events.length,
    events,
    diffs: [],
    ...overrides,
  });
}

function validEvent(seq: number): ActivityEvent {
  return {
    id: `e${seq}`,
    seq,
    sessionId: "old",
    ts: 1_000 + seq,
    status: "done",
    kind: "save",
    relPath: `src/f${seq}.ts`,
  };
}

function payloadForMissing(): DiffPayload {
  return {
    eventId: "missing",
    hunks: [],
    stat: { added: 0, removed: 0, hunks: 0, truncated: false },
    mode: "exact",
    fullAvailable: false,
  };
}

describe("HistoryPersistence (fake timers)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces scheduled writes to one write of the latest snapshot", async () => {
    // Real timers here: advancing fake time by 2 s also fires the unref'd Date-based watchdog that
    // clears Vitest's environment, so this test only asserts observable write counts.
    vi.useRealTimers();
    const store = makeStore();
    const adapter = makeAdapter();
    const persistence = new HistoryPersistence(store, adapter, { debounceMs: 20 });

    store.append(EDIT);
    persistence.schedule();
    // schedule() is idempotent while a timer is armed: the burst collapses into one write.
    persistence.schedule();
    await sleep(50);
    expect(adapter.writes).toHaveLength(1);
    expect((JSON.parse(adapter.writes[0] ?? "") as PersistedState).events).toHaveLength(1);

    store.append({ kind: "save", relPath: "src/a.ts" });
    persistence.schedule();
    await sleep(10);
    expect(adapter.writes).toHaveLength(1);
    await sleep(40);
    expect(adapter.writes).toHaveLength(2);
    const state = JSON.parse(adapter.writes[1] ?? "") as PersistedState;
    expect(state.events).toHaveLength(2);
    expect(store.stats().events).toBe(2);
    await persistence.dispose();
    expect(adapter.writes).toHaveLength(2);
  });

  it("defaults the debounce to 2000 ms", async () => {
    const store = makeStore();
    const adapter = makeAdapter();
    const persistence = new HistoryPersistence(store, adapter);
    store.append(EDIT);
    persistence.schedule();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(adapter.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.writes).toHaveLength(1);
  });

  it("flush writes once and is a no-op when the store is clean", async () => {
    const store = makeStore();
    const adapter = makeAdapter();
    const persistence = new HistoryPersistence(store, adapter, { debounceMs: 50 });
    store.append(EDIT);
    await persistence.flush();
    expect(adapter.writes).toHaveLength(1);
    await persistence.flush();
    await persistence.flush();
    expect(adapter.writes).toHaveLength(1);

    store.append({ kind: "terminal", command: "npm test" });
    await persistence.flush();
    expect(adapter.writes).toHaveLength(2);
  });

  it("skips rewrites when only the wall clock advances", async () => {
    // Regression: change detection used to include `now()`, so every flush looked dirty.
    // Real timers here, same as the debounce test above, so real time genuinely moves on.
    vi.useRealTimers();
    const store = makeStore();
    const adapter = makeAdapter();
    const onError = vi.fn();
    const persistence = new HistoryPersistence(store, adapter, { debounceMs: 10, onError });
    store.append(EDIT);
    await persistence.flush();
    expect(adapter.writes).toHaveLength(1);
    const firstText = adapter.writes[0];

    // Clock advances while the store stays untouched: nothing to write.
    await sleep(25);
    await persistence.flush();
    persistence.schedule();
    await sleep(40);
    expect(adapter.writes).toHaveLength(1);
    expect(adapter.stored).toBe(firstText);

    // No-op mutations must not mark the store dirty either.
    store.update("missing", { status: "done" });
    store.attachDiff("missing", payloadForMissing());
    await persistence.flush();
    expect(adapter.writes).toHaveLength(1);

    store.append({ kind: "save", relPath: "src/b.ts" });
    await persistence.flush();
    expect(adapter.writes).toHaveLength(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not rewrite immediately after load", async () => {
    const store = makeStore();
    const adapter = makeAdapter(persistedJSON([validEvent(1)]));
    const persistence = new HistoryPersistence(store, adapter, { debounceMs: 10 });
    expect(await persistence.load()).toBe("loaded");
    await persistence.flush();
    persistence.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.writes).toHaveLength(0);
  });

  it("flush cancels a pending debounced write", async () => {
    const store = makeStore();
    const adapter = makeAdapter();
    const persistence = new HistoryPersistence(store, adapter, { debounceMs: 100 });
    store.append(EDIT);
    persistence.schedule();
    await persistence.flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(adapter.writes).toHaveLength(1);
  });

  it("does not write anything for an empty store", async () => {
    const store = makeStore();
    const adapter = makeAdapter();
    const persistence = new HistoryPersistence(store, adapter, { debounceMs: 10 });
    persistence.schedule();
    await vi.advanceTimersByTimeAsync(100);
    await persistence.flush();
    expect(adapter.writes).toHaveLength(0);
  });

  it("dispose flushes pending changes", async () => {
    const store = makeStore();
    const adapter = makeAdapter();
    const persistence = new HistoryPersistence(store, adapter, { debounceMs: 5_000 });
    store.append(EDIT);
    persistence.schedule();
    await persistence.dispose();
    expect(adapter.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(adapter.writes).toHaveLength(1);
  });

  it("clear empties the store and removes the file", async () => {
    const store = makeStore();
    const adapter = makeAdapter(persistedJSON([validEvent(1)]));
    const persistence = new HistoryPersistence(store, adapter);
    await persistence.load();
    expect(store.isEmpty()).toBe(false);
    await persistence.clear();
    expect(store.isEmpty()).toBe(true);
    expect(adapter.removes).toBe(1);
    expect(adapter.stored).toBeUndefined();
  });

  it("quarantines corrupt JSON exactly once and starts fresh", async () => {
    const store = makeStore();
    const adapter = makeAdapter("{ not json");
    const onError = vi.fn();
    const persistence = new HistoryPersistence(store, adapter, { onError });
    expect(await persistence.load()).toBe("corrupt");
    expect(adapter.quarantines).toBe(1);
    expect(store.isEmpty()).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("quarantines a newer schema version and never overwrites it automatically", async () => {
    const store = makeStore();
    const adapter = makeAdapter(JSON.stringify({ v: 2, events: [] }));
    const persistence = new HistoryPersistence(store, adapter, { debounceMs: 10 });
    expect(await persistence.load()).toBe("newer");
    expect(adapter.quarantines).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    await persistence.flush();
    expect(adapter.writes).toHaveLength(0);
    expect(adapter.stored).toBe(JSON.stringify({ v: 2, events: [] }));
  });

  it("quarantines when more than 20% of events are invalid", async () => {
    const store = makeStore();
    const valid = [validEvent(1), validEvent(2), validEvent(3)];
    const invalid = { id: "bad", seq: "x", kind: "save" };
    const adapter = makeAdapter(persistedJSON([...valid, invalid]));
    const persistence = new HistoryPersistence(store, adapter);
    expect(await persistence.load()).toBe("corrupt");
    expect(adapter.quarantines).toBe(1);
    expect(store.isEmpty()).toBe(true);
  });

  it("tolerates a small number of malformed events", async () => {
    const store = makeStore();
    const events: unknown[] = [validEvent(1), validEvent(2), validEvent(3), validEvent(4), validEvent(5)];
    events.push({ id: "bad" });
    const adapter = makeAdapter(persistedJSON(events));
    const persistence = new HistoryPersistence(store, adapter);
    expect(await persistence.load()).toBe("loaded");
    expect(adapter.quarantines).toBe(0);
    expect(store.list().map((event) => event.id)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });

  it("loads a valid history and reports empty when nothing is stored", async () => {
    const store = makeStore();
    const empty = makeAdapter(undefined);
    expect(await new HistoryPersistence(makeStore(), empty).load()).toBe("empty");

    const adapter = makeAdapter(persistedJSON([validEvent(1), validEvent(2)], { seq: 7 }));
    const persistence = new HistoryPersistence(store, adapter);
    expect(await persistence.load()).toBe("loaded");
    expect(store.list()).toHaveLength(2);
    expect(store.seq).toBe(7);
    expect(store.sessionId).toBe("old");
    // Adopting the persisted session id is a mutation, but loading is not a dirty state:
    // the fingerprint recorded by load() covers it.
    await persistence.flush();
    expect(adapter.writes).toHaveLength(0);
  });

  it("calls onError for adapter failures and never throws", async () => {
    const store = makeStore();
    const failure = new Error("disk full");
    const writes: string[] = [];
    const adapter: StorageAdapter = {
      read: async () => {
        throw new Error("read failed");
      },
      write: async (text: string) => {
        writes.push(text);
        throw failure;
      },
      remove: async () => {
        throw new Error("remove failed");
      },
      quarantine: async () => {
        throw new Error("quarantine failed");
      },
    };
    const onError = vi.fn();
    const persistence = new HistoryPersistence(store, adapter, { debounceMs: 10, onError });
    expect(await persistence.load()).toBe("empty");
    expect(onError).toHaveBeenCalledTimes(1);

    store.append(EDIT);
    await expect(persistence.flush()).resolves.toBeUndefined();
    expect(writes).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[1]?.[0]).toBe(failure);

    // A failed write is retried on the next flush because nothing was recorded as saved.
    await persistence.flush();
    expect(writes).toHaveLength(2);
    expect(onError).toHaveBeenCalledTimes(3);

    await expect(persistence.clear(true)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(4);
    expect(store.isEmpty()).toBe(true);
  });

  it("ignores onError throwing", async () => {
    const store = makeStore();
    const adapter: StorageAdapter = {
      read: async () => undefined,
      write: async () => {
        throw new Error("nope");
      },
      remove: async () => undefined,
    };
    const persistence = new HistoryPersistence(store, adapter, {
      onError: () => {
        throw new Error("reporter failed");
      },
    });
    store.append(EDIT);
    await expect(persistence.flush()).resolves.toBeUndefined();
  });

  it("schedules nothing after dispose", async () => {
    const store = makeStore();
    const adapter = makeAdapter();
    const persistence = new HistoryPersistence(store, adapter, { debounceMs: 10 });
    await persistence.dispose();
    store.append(EDIT);
    persistence.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(adapter.writes).toHaveLength(0);
  });
});
