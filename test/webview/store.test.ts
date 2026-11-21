import { describe, expect, it } from "vitest";
import type { ActivityEvent, DiffPayload } from "../../src/shared/model";
import type { HostMessage } from "../../src/shared/protocol";
import { initialState, reducer } from "../../webview/src/app/store";
import type { AppState } from "../../webview/src/app/store";

function edit(id: string, seq: number, ts = 1_000): ActivityEvent {
  return {
    id,
    seq,
    sessionId: "s1",
    ts,
    status: "done",
    kind: "edit",
    relPath: `src/${id}.ts`,
    diff: { added: 1, removed: 0, hunks: 1, truncated: false },
  };
}

function apply(state: AppState, ...messages: HostMessage[]): AppState {
  return messages.reduce((current, message) => reducer(current, { type: "host", message }), state);
}

const init: Extract<HostMessage, { type: "init" }> = {
  type: "init",
  protocol: 3,
  surface: "panel",
  version: "0.1.0",
  locale: "en",
  direction: "ltr",
  settings: { ...initialState.settings },
  events: [edit("a", 3), edit("b", 1), edit("c", 2)],
  stats: { events: 3, files: 3, added: 3, removed: 0, sessionStartedAt: 0, durationMs: 100 },
  paused: false,
  filters: { kinds: [], query: "", timeRange: "session" },
  hasMore: true,
  sessionId: "s1",
};

describe("reducer — init", () => {
  it("sorts events newest-first and records the latest sequence", () => {
    const state = apply(initialState, init);
    expect(state.initialized).toBe(true);
    expect(state.events.map((event) => event.seq)).toEqual([3, 2, 1]);
    expect(state.latestSeq).toBe(3);
    expect(state.seenSeqAtTop).toBe(3);
    expect(state.hasMore).toBe(true);
  });

  it("prunes expansion ids that no longer exist", () => {
    const expanded = reducer({ ...initialState, expanded: ["a", "gone"] }, { type: "host", message: init });
    expect(expanded.expanded).toEqual(["a"]);
  });

  it("clears a toast on re-init", () => {
    const withToast = reducer(
      { ...initialState, toast: { id: 4, level: "info", message: "hi" } },
      { type: "host", message: init },
    );
    expect(withToast.toast).toBeNull();
  });
});

describe("reducer — live batches", () => {
  const started = apply(initialState, init);

  it("merges new events newest-first and ignores duplicates", () => {
    const state = apply(started, {
      type: "events",
      events: [edit("d", 5), edit("a", 3)],
      stats: started.stats,
      hasMore: true,
    });
    expect(state.events.map((event) => event.id)).toEqual(["d", "a", "c", "b"]);
    expect(state.latestSeq).toBe(5);
  });

  it("counts unseen events only while scrolled away", () => {
    const scrolled = reducer(started, { type: "scrolledAway", value: true });
    const withEvents = apply(scrolled, {
      type: "events",
      events: [edit("d", 5), edit("e", 6)],
      stats: started.stats,
      hasMore: true,
    });
    expect(withEvents.newActivityCount).toBe(2);
    const backAtTop = reducer(withEvents, { type: "scrolledAway", value: false });
    expect(backAtTop.newActivityCount).toBe(0);
    expect(backAtTop.seenSeqAtTop).toBe(6);
  });

  it("appends older pages and clears the pending flag", () => {
    const pending = reducer(started, { type: "olderRequested" });
    expect(pending.olderPending).toBe(true);
    const withOlder = apply(pending, { type: "older", events: [edit("z", 0)], hasMore: false });
    expect(withOlder.events.map((event) => event.id)).toEqual(["a", "c", "b", "z"]);
    expect(withOlder.olderPending).toBe(false);
    expect(withOlder.hasMore).toBe(false);
  });

  it("does not start an older request when the end has been reached", () => {
    const done = { ...started, hasMore: false };
    expect(reducer(done, { type: "olderRequested" })).toBe(done);
  });

  it("replaces an event in place for progress updates", () => {
    const state = apply(started, {
      type: "event-update",
      event: { ...edit("a", 3), status: "failed" },
      stats: started.stats,
    });
    expect(state.events.find((event) => event.id === "a")?.status).toBe("failed");
    expect(state.events).toHaveLength(3);
  });

  it("ignores progress updates for events it never saw", () => {
    const state = apply(started, {
      type: "event-update",
      event: edit("ghost", 9),
      stats: started.stats,
    });
    expect(state.events).toHaveLength(3);
  });

  it("resets counters on cleared", () => {
    const cleared = apply(
      reducer(started, { type: "expand", id: "a" }),
      { type: "cleared" },
    );
    expect(cleared.events).toEqual([]);
    expect(cleared.latestSeq).toBe(-1);
    expect(cleared.seenSeqAtTop).toBe(-1);
    expect(cleared.justCleared).toBe(true);
    expect(cleared.expanded).toEqual([]);
    expect(cleared.hasMore).toBe(false);
  });
});

describe("reducer — diffs", () => {
  const started = apply(initialState, init);
  const payload: DiffPayload = {
    eventId: "a",
    hunks: [],
    stat: { added: 1, removed: 0, hunks: 0, truncated: false },
    mode: "exact",
    fullAvailable: false,
  };

  it("moves an id through pending → loaded, clearing failed state", () => {
    const pending = reducer(started, { type: "setDiffPending", id: "a", pending: true });
    expect(pending.pendingDiffIds).toEqual(["a"]);
    const failed = reducer(pending, { type: "diffFailed", id: "a" });
    expect(failed.failedDiffIds).toContain("a");
    const loaded = apply(failed, { type: "diff", payload });
    expect(loaded.diffs.a).toBe(payload);
    expect(loaded.pendingDiffIds).toEqual([]);
    expect(loaded.failedDiffIds).toEqual([]);
  });

  it("collapses and marks an expired diff", () => {
    const expanded = reducer(started, { type: "expand", id: "a" });
    const expired = apply(expanded, { type: "diff-expired", id: "a" });
    expect(expired.expanded).toEqual([]);
    expect(expired.expiredDiffIds).toEqual(["a"]);
  });

  it("drops diffs and expansion for events evicted by the cap", () => {
    const capped: AppState = {
      ...started,
      settings: { ...started.settings, maxEvents: 100 },
      events: [edit("a", 3)],
      diffs: { a: payload, stale: payload },
      expanded: ["a", "stale"],
    };
    const next = apply(capped, {
      type: "events",
      events: [edit("new", 4)],
      stats: started.stats,
      hasMore: false,
    });
    expect(next.diffs.stale).toBeUndefined();
    expect(next.expanded).not.toContain("stale");
  });
});

describe("reducer — filters, expansion and toasts", () => {
  it("clamps queries and avoids identical updates", () => {
    const long = "x".repeat(500);
    const state = reducer(initialState, { type: "setQuery", query: long });
    expect(state.filters.query).toHaveLength(200);
    expect(reducer(state, { type: "setQuery", query: long })).toBe(state);
  });

  it("toggles kinds and clears them", () => {
    const withEdit = reducer(initialState, { type: "toggleKind", kind: "edit" });
    expect(withEdit.filters.kinds).toEqual(["edit"]);
    const without = reducer(withEdit, { type: "toggleKind", kind: "edit" });
    expect(without.filters.kinds).toEqual([]);
    expect(reducer(withEdit, { type: "clearKinds" }).filters.kinds).toEqual([]);
  });

  it("expands, collapses and merges expandAll", () => {
    const one = reducer(initialState, { type: "expand", id: "a" });
    const both = reducer(one, { type: "expandAll", ids: ["a", "b"] });
    expect(both.expanded).toEqual(["a", "b"]);
    expect(reducer(both, { type: "collapse", id: "a" }).expanded).toEqual(["b"]);
  });

  it("increments toast ids and dismisses", () => {
    const first = reducer(initialState, { type: "showToast", level: "warn", message: "one" });
    const second = reducer(first, { type: "showToast", level: "error", message: "two" });
    expect(second.toast).toMatchObject({ id: 2, level: "error", message: "two" });
    expect(reducer(second, { type: "dismissToast" }).toast).toBeNull();
  });

  it("clearFilters resets every filter at once", () => {
    const dirty = reducer(
      reducer(initialState, { type: "setKinds", kinds: ["task"] }),
      { type: "setTimeRange", timeRange: "1h" },
    );
    const clean = reducer(dirty, { type: "clearFilters" });
    expect(clean.filters).toEqual({ kinds: [], query: "", timeRange: "session" });
  });
});
