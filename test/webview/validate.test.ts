import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_EVENTS,
  parseDiffPayload,
  parseEvent,
  parseHostMessage,
  parsePersistedState,
} from "../../webview/src/app/validate";

const baseEvent = {
  id: "e1",
  seq: 7,
  sessionId: "s1",
  ts: 1_000,
  status: "done",
  kind: "edit",
  relPath: "src/a.ts",
  diff: { added: 2, removed: 1, hunks: 1, truncated: false },
};

const stats = {
  events: 3,
  files: 2,
  added: 5,
  removed: 1,
  sessionStartedAt: 1,
  durationMs: 10,
};

describe("parseHostMessage", () => {
  it("rejects non-objects, arrays and unknown types", () => {
    expect(parseHostMessage(null)).toBeUndefined();
    expect(parseHostMessage([])).toBeUndefined();
    expect(parseHostMessage({ type: "mystery" })).toBeUndefined();
  });

  it("parses a complete init and sanitizes unknown surface/locale values", () => {
    const message = parseHostMessage({
      type: "init",
      protocol: 3,
      surface: "hologram",
      version: "0.1.0",
      locale: "fa",
      direction: "rtl",
      settings: { maxEvents: 400 },
      events: [baseEvent],
      stats,
      paused: true,
      filters: { kinds: ["edit", "nope", "edit"], query: "x", timeRange: "5m" },
      hasMore: true,
      sessionId: "s1",
    });
    expect(message?.type).toBe("init");
    if (message?.type !== "init") return;
    expect(message.surface).toBe("panel");
    expect(message.locale).toBe("fa");
    expect(message.direction).toBe("rtl");
    expect(message.protocol).toBe(3);
    expect(message.paused).toBe(true);
    expect(message.hasMore).toBe(true);
    expect(message.events).toHaveLength(1);
    expect(message.filters.kinds).toEqual(["edit"]);
    expect(message.settings.maxEvents).toBe(400);
    expect(message.settings.locale).toBe("auto");
  });

  it("requires stats on init and on events batches", () => {
    expect(parseHostMessage({ type: "init", version: "1" })).toBeUndefined();
    expect(parseHostMessage({ type: "events", events: [baseEvent] })).toBeUndefined();
    const older = parseHostMessage({ type: "older", events: [baseEvent], hasMore: false });
    expect(older?.type).toBe("older");
  });

  it("caps oversized event batches", () => {
    const events = Array.from({ length: MAX_MESSAGE_EVENTS + 25 }, (_, i) => ({
      ...baseEvent,
      id: `e${i}`,
      seq: i,
    }));
    const message = parseHostMessage({ type: "init", version: "1", stats, events });
    expect(message?.type).toBe("init");
    if (message?.type !== "init") return;
    expect(message.events).toHaveLength(MAX_MESSAGE_EVENTS);
  });

  it("drops malformed events inside a valid batch", () => {
    const message = parseHostMessage({
      type: "init",
      version: "1",
      stats,
      events: [{ ...baseEvent, id: "" }, { ...baseEvent, kind: "aliens" }, baseEvent],
    });
    if (message?.type !== "init") throw new Error("unexpected");
    expect(message.events.map((event) => event.id)).toEqual(["e1"]);
  });

  it("accepts diff-expired only with a non-empty id", () => {
    expect(parseHostMessage({ type: "diff-expired" })).toBeUndefined();
    expect(parseHostMessage({ type: "diff-expired", id: "" })).toBeUndefined();
    expect(parseHostMessage({ type: "diff-expired", id: "e1" })).toEqual({ type: "diff-expired", id: "e1" });
  });

  it("normalizes toast levels and truncates messages", () => {
    const message = parseHostMessage({ type: "toast", level: "fatal", message: "x".repeat(900) });
    expect(message).toMatchObject({ type: "toast", level: "info" });
    if (message?.type !== "toast") return;
    expect(message.message).toHaveLength(500);
  });

  it("keeps event-update only when both event and stats validate", () => {
    expect(parseHostMessage({ type: "event-update", event: baseEvent })).toBeUndefined();
    expect(
      parseHostMessage({ type: "event-update", event: { ...baseEvent, status: "running" }, stats }),
    ).toMatchObject({ type: "event-update" });
  });
});

describe("parseEvent", () => {
  it("truncates searchText and keeps optional fields", () => {
    const event = parseEvent({ ...baseEvent, searchText: "q".repeat(900), reason: "redo", eol: "\r\n" });
    if (event?.kind !== "edit") throw new Error("unexpected");
    expect(event.searchText).toHaveLength(400);
    expect(event.reason).toBe("redo");
    expect(event.eol).toBe("\r\n");
  });

  it("rejects missing ids and unknown kinds", () => {
    expect(parseEvent({ ...baseEvent, id: undefined })).toBeUndefined();
    expect(parseEvent({ ...baseEvent, kind: "other" })).toBeUndefined();
  });

  it("parses every event kind with defaults", () => {
    expect(parseEvent({ ...baseEvent, kind: "save", source: "watcher" })).toMatchObject({
      kind: "save",
      source: "watcher",
    });
    expect(parseEvent({ ...baseEvent, kind: "file-rename", fromPath: "old.ts" })).toMatchObject({
      kind: "file-rename",
      fromPath: "old.ts",
    });
    expect(parseEvent({ ...baseEvent, kind: "task", taskName: "build", taskSource: "npm" })).toMatchObject({
      kind: "task",
      taskName: "build",
      taskSource: "npm",
    });
    expect(parseEvent({ ...baseEvent, kind: "debug", debugName: "launch", debugType: "node" })).toMatchObject({
      kind: "debug",
      debugType: "node",
    });
    expect(parseEvent({ ...baseEvent, kind: "terminal", command: "npm test" })).toMatchObject({
      kind: "terminal",
      command: "npm test",
    });
  });
});

describe("parseDiffPayload", () => {
  it("defaults to exact mode and preserves truncation extras", () => {
    const payload = parseDiffPayload({
      eventId: "e1",
      stat: { added: 1, removed: 0, hunks: 1, truncated: true, shownLines: 10, totalLines: 99 },
      hunks: [
        {
          header: "@@ -1,1 +1,1 @@",
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: [{ kind: "added", text: "x", newLine: 1, words: [{ text: "x", changed: true }] }],
        },
      ],
    });
    expect(payload?.mode).toBe("exact");
    expect(payload?.fullAvailable).toBe(false);
    expect(payload?.stat).toMatchObject({ shownLines: 10, totalLines: 99 });
    expect(payload?.hunks[0].lines[0].words).toEqual([{ text: "x", changed: true }]);
  });

  it("rejects payloads without an eventId", () => {
    expect(parseDiffPayload({ hunks: [], stat: {} })).toBeUndefined();
  });
});

describe("parsePersistedState", () => {
  it("keeps only string ids, clamps the anchor and the list length", () => {
    const saved = parsePersistedState({
      expanded: ["a", 3, "b", ...Array.from({ length: 300 }, (_, i) => `id${i}`)],
      anchor: -12,
      filterPanelOpen: "yes",
    });
    expect(saved.expanded).toHaveLength(200);
    expect(saved.expanded.slice(0, 2)).toEqual(["a", "b"]);
    expect(saved.anchor).toBe(0);
    expect(saved.filterPanelOpen).toBe(false);
  });
});
