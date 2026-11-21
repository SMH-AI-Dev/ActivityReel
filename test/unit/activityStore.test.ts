import { describe, expect, it } from "vitest";
import { ActivityStore } from "../../src/core/store/activityStore";
import type { PersistedState } from "../../src/core/store/activityStore";
import { DEFAULT_SETTINGS, LIMITS } from "../../src/shared/constants";
import type { ActivityEvent, DiffPayload, DiffStat, EventDraft } from "../../src/shared/model";

let idCounter = 0;

function makeStore(options: { maxEvents?: number; retainedDiffs?: number; start?: number } = {}): {
  store: ActivityStore;
  setNow: (value: number) => void;
} {
  let clock = options.start ?? 1_000;
  const store = new ActivityStore({
    maxEvents: options.maxEvents,
    retainedDiffs: options.retainedDiffs,
    sessionId: "session-1",
    now: () => clock,
    idFactory: () => `id-${(idCounter += 1)}`,
  });
  return {
    store,
    setNow: (value: number) => {
      clock = value;
    },
  };
}

const STAT: DiffStat = { added: 2, removed: 1, hunks: 1, truncated: false };

function editDraft(relPath = "src/a.ts"): EventDraft {
  return { kind: "edit", relPath, diff: STAT, status: "done" };
}

function payloadFor(eventId: string, text = "hello"): DiffPayload {
  return {
    eventId,
    hunks: [
      {
        header: "@@ -1,1 +1,1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { kind: "removed", text: "old", oldLine: 1 },
          { kind: "added", text, newLine: 1 },
        ],
      },
    ],
    stat: STAT,
    mode: "exact",
    fullAvailable: true,
  };
}

describe("ActivityStore.append", () => {
  it("fills identity, ordering and defaults", () => {
    const { store, setNow } = makeStore();
    setNow(5_000);
    const first = store.append(editDraft());
    setNow(6_000);
    const second = store.append({ kind: "save", relPath: "src/b.ts" });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(first.sessionId).toBe("session-1");
    expect(second.sessionId).toBe("session-1");
    expect(first.ts).toBe(5_000);
    expect(second.ts).toBe(6_000);
    expect(first.status).toBe("done");
    expect(first.id).not.toBe(second.id);
    expect(store.seq).toBe(2);
    expect(store.list().map((event) => event.seq)).toEqual([1, 2]);
  });

  it("keeps an explicit running status and assigns unique ids without a provided factory", () => {
    const store = new ActivityStore({ sessionId: "s" });
    const a = store.append({ kind: "task", taskName: "build", taskSource: "npm", status: "running" });
    const b = store.append({ kind: "task", taskName: "test", taskSource: "npm" });
    expect(a.status).toBe("running");
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
    expect(typeof store.sessionId).toBe("string");
  });

  it("returns copies so callers cannot mutate store state", () => {
    const { store } = makeStore();
    const event = store.append(editDraft());
    (event as { status: string }).status = "failed";
    expect(store.get(event.id)?.status).toBe("done");
    const listed = store.list();
    listed.pop();
    expect(store.list()).toHaveLength(1);
  });

  it("rejects absolute paths", () => {
    const { store } = makeStore();
    expect(() => store.append(editDraft("C:\\Users\\me\\secret.ts"))).toThrow();
    expect(() => store.append({ kind: "save", relPath: "/home/me/x.ts" })).toThrow();
    expect(store.isEmpty()).toBe(true);
  });
});

describe("ActivityStore.update", () => {
  it("applies only patchable fields and ignores unknown ids", () => {
    const { store } = makeStore();
    const task = store.append({ kind: "task", taskName: "build", taskSource: "npm", status: "running" });
    const updated = store.update(task.id, { status: "failed", exitCode: 2, durationMs: 1200 });
    expect(updated?.status).toBe("failed");
    expect(updated?.kind === "task" && updated.exitCode).toBe(2);
    expect(updated?.kind === "task" && updated.durationMs).toBe(1200);

    const terminal = store.append({ kind: "terminal", command: "old" });
    const patched = store.update(terminal.id, { command: "npm test", cwd: "src" });
    expect(patched?.kind === "terminal" && patched.command).toBe("npm test");
    expect(patched?.kind === "terminal" && patched.cwd).toBe("src");

    expect(store.update("missing", { status: "done" })).toBeUndefined();
  });

  it("updates are visible through get and list", () => {
    const { store } = makeStore();
    const event = store.append({ kind: "debug", debugName: "Run", debugType: "node", debugSessionId: "d", status: "running" });
    store.update(event.id, { status: "done", durationMs: 50 });
    expect(store.get(event.id)?.status).toBe("done");
    expect(store.list()[0]?.status).toBe("done");
  });

  it("returns a copy when a patch is rejected", () => {
    const { store } = makeStore();
    // `status` is copied to the top of every event, so a non-string value rejects the whole patch.
    const event = store.append({ kind: "terminal", command: "npm test", status: "running" });
    const revisionBefore = store.revision;
    const result = store.update(event.id, { status: 42 as unknown as "failed", command: "npm run build" });
    expect(result).toBeDefined();
    expect(result?.status).toBe("running");
    expect(result?.kind === "terminal" && result.command).toBe("npm test");
    expect(store.revision).toBe(revisionBefore);
    if (result) (result as { status?: string }).status = "failed";
    expect(store.get(event.id)?.status).toBe("running");
    expect(store.list()[0]?.status).toBe("running");
    // The store's internal object stays valid and patchable afterwards.
    expect(store.update(event.id, { status: "failed" })?.status).toBe("failed");
  });

  it("bumps the revision only for mutations that change serialized output", () => {
    const { store } = makeStore();
    const start = store.revision;
    expect(store.update("missing", { status: "done" })).toBeUndefined();
    store.attachDiff("missing", payloadFor("missing"));
    expect(store.revision).toBe(start);

    const event = store.append(editDraft());
    expect(store.revision).toBe(start + 1);
    store.attachDiff(event.id, payloadFor(event.id));
    expect(store.revision).toBe(start + 2);
    store.update(event.id, { status: "failed" });
    expect(store.revision).toBe(start + 3);
    store.setMaxEvents(50);
    const afterResize = store.revision;
    expect(store.load({ v: 1, sessionId: "session-1", sessionStartedAt: 0, seq: 0, events: [], diffs: [] })).toBe(true);
    expect(store.revision).toBe(afterResize + 1);
    store.clear();
    expect(store.revision).toBe(afterResize + 2);
    expect(store.load({ v: 2 })).toBe(false);
    expect(store.revision).toBe(afterResize + 2);
  });
});

describe("ActivityStore ring buffer and diffs", () => {
  it("evicts oldest events and their diffs beyond maxEvents", () => {
    const { store } = makeStore({ maxEvents: 100 });
    const first = store.append(editDraft());
    store.attachDiff(first.id, payloadFor(first.id));
    for (let i = 0; i < 120; i += 1) store.append(editDraft(`src/f${i}.ts`));

    const events = store.list();
    expect(events).toHaveLength(100);
    expect(events[0]?.seq).toBe(22);
    expect(events[events.length - 1]?.seq).toBe(121);
    expect(store.get(first.id)).toBeUndefined();
    expect(store.getDiff(first.id)).toBeUndefined();
    expect(store.stats().events).toBe(100);
  });

  it("defaults maxEvents to DEFAULT_SETTINGS.maxEvents", () => {
    expect(DEFAULT_SETTINGS.maxEvents).toBe(1000);
    const { store } = makeStore();
    for (let i = 0; i < 1005; i += 1) store.append({ kind: "save", relPath: `src/${i}.ts` });
    expect(store.list()).toHaveLength(1000);
    expect(store.list()[0]?.seq).toBe(6);
  });

  it("retains only the newest 300 diffs by seq", () => {
    const { store } = makeStore({ maxEvents: 500 });
    const ids: string[] = [];
    for (let i = 0; i < 320; i += 1) {
      const event = store.append(editDraft(`src/${i}.ts`));
      store.attachDiff(event.id, payloadFor(event.id));
      ids.push(event.id);
    }
    expect(store.getDiff(ids[19]!)).toBeUndefined();
    expect(store.getDiff(ids[20]!)).toBeDefined();
    expect(store.getDiff(ids[319]!)).toBeDefined();
    expect(LIMITS.retainedDiffEvents).toBe(300);
  });

  it("attachDiff ignores unknown events", () => {
    const { store } = makeStore();
    store.attachDiff("nope", payloadFor("nope"));
    expect(store.getDiff("nope")).toBeUndefined();
  });

  it("returns diff copies", () => {
    const { store } = makeStore();
    const event = store.append(editDraft());
    store.attachDiff(event.id, payloadFor(event.id));
    const diff = store.getDiff(event.id);
    if (diff) diff.stat.added = 99;
    expect(store.getDiff(event.id)?.stat.added).toBe(2);
  });

  it("setMaxEvents clamps and re-applies the cap", () => {
    const { store } = makeStore();
    for (let i = 0; i < 150; i += 1) store.append(editDraft(`src/${i}.ts`));
    store.setMaxEvents(100);
    expect(store.list()).toHaveLength(100);
    store.setMaxEvents(1);
    expect(store.list()).toHaveLength(LIMITS.maxEventsMin);
    store.setMaxEvents(99_999);
    expect(store.list()).toHaveLength(100);
  });
});

describe("ActivityStore.stats", () => {
  it("counts unique file paths across file-ish kinds", () => {
    const { store } = makeStore();
    store.append(editDraft("src/a.ts"));
    store.append({ kind: "save", relPath: "src/a.ts" });
    store.append({ kind: "file-create", relPath: "src/b.ts" });
    store.append({ kind: "file-change", relPath: "src/c.ts" });
    store.append({ kind: "file-rename", relPath: "src/d.ts", fromPath: "src/old.ts" });
    store.append({ kind: "task", taskName: "build", taskSource: "npm" });
    store.append({ kind: "terminal", command: "npm test" });
    store.append({ kind: "debug", debugName: "Run", debugType: "node", debugSessionId: "d" });

    const stats = store.stats();
    expect(stats.files).toBe(4);
    expect(stats.events).toBe(8);
  });

  it("sums edit added/removed and derives duration", () => {
    const { store, setNow } = makeStore({ start: 10_000 });
    store.append({ kind: "edit", relPath: "a.ts", diff: { added: 3, removed: 4, hunks: 1, truncated: false } });
    store.append({ kind: "edit", relPath: "b.ts", diff: { added: 5, removed: 0, hunks: 1, truncated: false } });
    store.append({ kind: "save", relPath: "b.ts" });
    setNow(13_500);
    const stats = store.stats();
    expect(stats.added).toBe(8);
    expect(stats.removed).toBe(4);
    expect(stats.sessionStartedAt).toBe(10_000);
    expect(stats.durationMs).toBe(3_500);
  });

  it("drops stats of evicted events", () => {
    const { store } = makeStore({ maxEvents: 100 });
    store.append({ kind: "edit", relPath: "a.ts", diff: { added: 3, removed: 4, hunks: 1, truncated: false } });
    for (let i = 0; i < 100; i += 1) store.append({ kind: "save", relPath: `s${i}.ts` });
    const stats = store.stats();
    expect(stats.added).toBe(0);
    expect(stats.files).toBe(100);
  });

  it("clear resets everything including the session", () => {
    const { store } = makeStore({ start: 1 });
    const event = store.append(editDraft());
    store.attachDiff(event.id, payloadFor(event.id));
    store.clear();
    expect(store.isEmpty()).toBe(true);
    expect(store.stats().events).toBe(0);
    expect(store.stats().files).toBe(0);
    expect(store.getDiff(event.id)).toBeUndefined();
    expect(store.sessionId).not.toBe("session-1");
    expect(store.seq).toBe(0);
  });
});

describe("ActivityStore paging", () => {
  it("pageNewest returns an ascending slice with hasMore", () => {
    const { store } = makeStore();
    for (let i = 0; i < 10; i += 1) store.append({ kind: "save", relPath: `f${i}.ts` });
    const page = store.pageNewest(4);
    expect(page.events.map((event) => event.seq)).toEqual([7, 8, 9, 10]);
    expect(page.hasMore).toBe(true);

    const all = store.pageNewest(20);
    expect(all.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(all.hasMore).toBe(false);
  });

  it("pageOlder returns events older than beforeSeq", () => {
    const { store } = makeStore();
    for (let i = 0; i < 10; i += 1) store.append({ kind: "save", relPath: `f${i}.ts` });
    const page = store.pageOlder(8, 3);
    expect(page.events.map((event) => event.seq)).toEqual([5, 6, 7]);
    expect(page.hasMore).toBe(true);

    const rest = store.pageOlder(5, 10);
    expect(rest.events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(rest.hasMore).toBe(false);

    const none = store.pageOlder(1, 10);
    expect(none.events).toEqual([]);
    expect(none.hasMore).toBe(false);
  });

  it("uses LIMITS.feedPageSize by default", () => {
    const { store } = makeStore({ maxEvents: 1000 });
    for (let i = 0; i < LIMITS.feedPageSize + 5; i += 1) store.append({ kind: "save", relPath: `f${i}.ts` });
    expect(store.pageNewest().events).toHaveLength(LIMITS.feedPageSize);
    expect(store.pageOlder(store.seq).events).toHaveLength(LIMITS.feedPageSize);
  });
});

describe("ActivityStore serialize/load", () => {
  it("round-trips events, diffs and session metadata", () => {
    const { store, setNow } = makeStore({ start: 42 });
    const a = store.append(editDraft("src/a.ts"));
    store.attachDiff(a.id, { ...payloadFor(a.id), unified: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n" });
    store.append({ kind: "task", taskName: "build", taskSource: "npm", status: "running" });
    setNow(99);
    store.append({ kind: "terminal", command: "npm test", cwd: "packages/app" });

    const state = store.serialize();
    expect(state.v).toBe(1);
    expect(state.sessionId).toBe("session-1");
    expect(state.sessionStartedAt).toBe(42);
    expect(state.seq).toBe(3);
    expect(state.events).toHaveLength(3);
    expect(state.diffs).toHaveLength(1);

    const restored = makeStore();
    expect(restored.store.load(JSON.parse(JSON.stringify(state)))).toBe(true);
    expect(restored.store.sessionId).toBe("session-1");
    expect(restored.store.seq).toBe(3);
    expect(restored.store.stats()).toMatchObject({ events: 3, files: 1, added: 2, removed: 1 });
    expect(restored.store.getDiff(a.id)?.unified).toContain("+new");
    const next = restored.store.append(editDraft());
    expect(next.seq).toBe(4);
  });

  it("rejects newer versions and non-objects", () => {
    const { store } = makeStore();
    expect(store.load({ v: 2, events: [] })).toBe(false);
    expect(store.load({ v: "1", events: [] })).toBe(false);
    expect(store.load(null)).toBe(false);
    expect(store.load(42)).toBe(false);
    expect(store.load([])).toBe(false);
    expect(store.load({ nope: true })).toBe(false);
  });

  it("drops malformed events and invalid diffs", () => {
    const { store } = makeStore();
    const good = {
      id: "e1",
      seq: 3,
      sessionId: "sx",
      ts: 10,
      status: "done",
      kind: "save",
      relPath: "src/a.ts",
    };
    const state = {
      v: 1,
      sessionId: "sx",
      sessionStartedAt: 5,
      seq: 9,
      events: [
        good,
        { ...good, id: "e2", seq: 4, kind: "bogus" },
        { ...good, id: 7, seq: 5 },
        { ...good, id: "e3", seq: "6" },
        { ...good, id: "e4", seq: 7, status: "weird" },
        { ...good, id: "e5", seq: 8, relPath: "D:/abs/a.ts" },
        { ...good, id: "e6", seq: 9, kind: "edit" },
        null,
        "string",
      ],
      diffs: [
        { eventId: "e1", hunks: [], stat: STAT, mode: "exact", fullAvailable: true },
        { eventId: "missing", hunks: [], stat: STAT, mode: "exact", fullAvailable: true },
        { eventId: "e1", hunks: "no", stat: STAT, mode: "exact", fullAvailable: true },
      ],
    };
    expect(store.load(state)).toBe(true);
    expect(store.list().map((event) => event.id)).toEqual(["e1"]);
    expect(store.seq).toBe(9);
    expect(store.getDiff("e1")).toBeDefined();
  });

  it("never serializes absolute paths", () => {
    const { store } = makeStore();
    store.append(editDraft("src/ok.ts"));
    const state = store.serialize();
    const poisoned = JSON.parse(JSON.stringify(state)) as PersistedState;
    const victim = poisoned.events[0];
    if (victim) (victim as unknown as Record<string, unknown>).relPath = "/home/me/secret.ts";
    const fresh = makeStore();
    fresh.store.load(poisoned);
    expect(fresh.store.isEmpty()).toBe(true);
  });

  it("re-applies caps on load", () => {
    const events: ActivityEvent[] = [];
    for (let i = 1; i <= 150; i += 1) {
      events.push({ id: `e${i}`, seq: i, sessionId: "s", ts: i, status: "done", kind: "save", relPath: `f${i}.ts` });
    }
    const diffs: DiffPayload[] = events.map((event) => ({ ...payloadFor(event.id), eventId: event.id }));
    const { store } = makeStore({ maxEvents: 100, retainedDiffs: 10 });
    expect(store.load({ v: 1, sessionId: "s", sessionStartedAt: 0, seq: 150, events, diffs })).toBe(true);
    expect(store.list()).toHaveLength(100);
    expect(store.list()[0]?.seq).toBe(51);
    expect(store.getDiff("e141")).toBeDefined();
    expect(store.getDiff("e140")).toBeUndefined();
  });

  it("caps the serialized state at LIMITS.persistMaxBytes, dropping oldest diffs before events", () => {
    const { store } = makeStore({ maxEvents: 200 });
    const big = "x".repeat(200_000);
    for (let i = 0; i < 80; i += 1) {
      const event = store.append(editDraft(`src/${i}.ts`));
      store.attachDiff(event.id, { ...payloadFor(event.id), unified: big });
    }
    const state = store.serialize();
    const bytes = new TextEncoder().encode(JSON.stringify(state)).length;
    expect(bytes).toBeLessThanOrEqual(LIMITS.persistMaxBytes);
    expect(state.events).toHaveLength(80);
    expect(state.diffs.length).toBeLessThan(80);
    // The surviving diffs belong to the newest events.
    const keptIds = new Set(state.diffs.map((diff) => diff.eventId));
    const newestEvent = state.events[state.events.length - 1];
    expect(newestEvent && keptIds.has(newestEvent.id)).toBe(true);
    const oldestEvent = state.events[0];
    if (state.diffs.length > 0 && oldestEvent) expect(keptIds.has(oldestEvent.id)).toBe(false);
  });

  it("drops oldest events when diffs alone cannot fit", () => {
    const { store } = makeStore({ maxEvents: 200 });
    const huge = "y".repeat(300_000);
    for (let i = 0; i < 60; i += 1) {
      const event = store.append({ kind: "save", relPath: `${"d".repeat(huge.length)}/${i}.ts` });
      store.attachDiff(event.id, { ...payloadFor(event.id), unified: huge });
    }
    const state = store.serialize();
    const bytes = new TextEncoder().encode(JSON.stringify(state)).length;
    expect(bytes).toBeLessThanOrEqual(LIMITS.persistMaxBytes);
    expect(state.diffs).toHaveLength(0);
    expect(state.events.length).toBeLessThan(60);
    expect(state.events.length).toBeGreaterThan(0);
  });

  it("empty state serializes to a valid shape", () => {
    const { store } = makeStore();
    const state = store.serialize();
    expect(state.events).toEqual([]);
    expect(state.diffs).toEqual([]);
    expect(state.seq).toBe(0);
    expect(store.isEmpty()).toBe(true);
  });
});
