import { describe, expect, it } from "vitest";
import {
  EXPORT_MAX_BYTES,
  EXPORT_TRUNCATED_MARKER,
  exportJson,
  exportMarkdown,
} from "../../src/core/export/exporters";
import type { ExportBundle } from "../../src/core/export/exporters";
import { DEFAULT_SETTINGS } from "../../src/shared/constants";
import type {
  ActivityEvent,
  DiffPayload,
  SessionStats,
  Settings,
} from "../../src/shared/model";

const STATS: SessionStats = {
  events: 3,
  files: 2,
  added: 5,
  removed: 2,
  sessionStartedAt: Date.UTC(2026, 10, 21, 9, 0, 0),
  durationMs: 65_000,
};

function meta(settings: Settings = DEFAULT_SETTINGS): ExportBundle["meta"] {
  return {
    exportedAt: Date.UTC(2026, 10, 21, 10, 30, 15),
    extensionVersion: "0.1.0",
    settings,
    sessionId: "session-abc",
  };
}

function editEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "e1",
    seq: 1,
    sessionId: "session-abc",
    ts: Date.UTC(2026, 10, 21, 9, 5, 7),
    status: "done",
    kind: "edit",
    relPath: "src/تست/سلام.ts",
    diff: { added: 3, removed: 1, hunks: 1, truncated: false },
    ...overrides,
  } as ActivityEvent;
}

function payload(eventId = "e1", unified = "@@ -1,2 +1,2 @@\n-old line\n+new line 👋\n"): DiffPayload {
  return {
    eventId,
    hunks: [
      {
        header: "@@ -1,2 +1,2 @@",
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [
          { kind: "removed", text: "old line", oldLine: 1 },
          { kind: "added", text: "new line 👋", newLine: 1 },
        ],
      },
    ],
    stat: { added: 1, removed: 1, hunks: 1, truncated: false },
    mode: "exact",
    fullAvailable: true,
    unified,
  };
}

function bundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    events: [editEvent()],
    stats: STATS,
    diffs: { e1: payload() },
    meta: meta(),
    ...overrides,
  };
}

describe("exportJson", () => {
  it("produces parseable, pretty JSON with schema, meta, settings and newest-first events", () => {
    const save: ActivityEvent = {
      id: "e2",
      seq: 2,
      sessionId: "session-abc",
      ts: Date.UTC(2026, 10, 21, 9, 6, 0),
      status: "done",
      kind: "save",
      relPath: "src/a.ts",
    };
    const text = exportJson(bundle({ events: [editEvent(), save] }));
    expect(text).toContain('\n  "schemaVersion": 1');
    const parsed = JSON.parse(text) as {
      schemaVersion: number;
      exportedAt: string;
      extensionVersion: string;
      sessionId: string;
      settings: Record<string, unknown>;
      stats: SessionStats;
      events: ActivityEvent[];
      diffs: DiffPayload[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.exportedAt).toBe("2026-11-21T10:30:15.000Z");
    expect(parsed.extensionVersion).toBe("0.1.0");
    expect(parsed.sessionId).toBe("session-abc");
    expect(parsed.settings.maxEvents).toBe(DEFAULT_SETTINGS.maxEvents);
    expect(parsed.settings).not.toHaveProperty("secrets");
    expect(parsed.stats.files).toBe(2);
    expect(parsed.events.map((event) => event.seq)).toEqual([2, 1]);
    expect(parsed.events[1]?.kind === "edit" && parsed.events[1].relPath).toBe("src/تست/سلام.ts");
    expect(Array.isArray(parsed.diffs)).toBe(true);
    expect(parsed.diffs[0]?.unified).toContain("+new line 👋");
  });

  it("never emits absolute paths", () => {
    const evil = editEvent({ id: "e3", seq: 3, relPath: "/home/me/secret.ts" });
    const renamed = {
      id: "e4",
      seq: 4,
      sessionId: "s",
      ts: 1,
      status: "done",
      kind: "file-rename",
      relPath: "src/new.ts",
      fromPath: "C:\\Users\\me\\old.ts",
    } as ActivityEvent;
    const text = exportJson(bundle({ events: [evil, renamed] }));
    expect(text).not.toContain("/home/me/secret.ts");
    expect(text).not.toContain("C:\\Users");
    const parsed = JSON.parse(text) as { events: ActivityEvent[] };
    expect(parsed.events).toEqual([]);
    expect((parsed as unknown as { omittedForPrivacy: number }).omittedForPrivacy).toBe(2);
  });

  it("caps output at 5 MB with a marker", () => {
    const events: ActivityEvent[] = [];
    const diffs: Record<string, DiffPayload> = {};
    for (let i = 0; i < 30; i += 1) {
      const id = `big-${i}`;
      events.push(editEvent({ id, seq: i + 1 }));
      diffs[id] = payload(id, `${"z".repeat(200_000)}\n`);
    }
    const text = exportJson(bundle({ events, diffs }));
    expect(utf8Bytes(text)).toBeLessThanOrEqual(EXPORT_MAX_BYTES);
    expect(text).toContain(EXPORT_TRUNCATED_MARKER);
    expect(EXPORT_TRUNCATED_MARKER).toContain("truncated");
  });
});

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

describe("exportMarkdown", () => {
  it("contains the title, stats, kind, path and time newest-first", () => {
    const save: ActivityEvent = {
      id: "e2",
      seq: 2,
      sessionId: "s",
      ts: Date.UTC(2026, 10, 21, 9, 6, 0),
      status: "done",
      kind: "save",
      relPath: "src/b.ts",
    };
    const md = exportMarkdown(bundle({ events: [editEvent(), save] }));
    expect(md.startsWith("# ActivityReel activity export")).toBe(true);
    expect(md).toContain("Stats: 3 events · 2 files · +5/−2");
    expect(md).toContain("Edit · سلام.ts");
    expect(md).toContain("سلام.ts");
    expect(md).toContain("Save · b.ts");
    const savePos = md.indexOf("Save · b.ts");
    const editPos = md.indexOf("سلام.ts");
    expect(savePos).toBeGreaterThan(-1);
    expect(savePos).toBeLessThan(editPos);
    expect(md).toContain("+3/−1");
    expect(md).toContain("```diff");
    expect(md).toContain("+new line 👋");
  });

  it("switches to ~~~ fences when the content contains a backtick fence", () => {
    const md = exportMarkdown(
      bundle({ diffs: { e1: payload("e1", "@@ -1 +1 @@\n+```ts\n+code\n+```\n") } }),
    );
    expect(md).toContain("~~~diff");
    expect(md).not.toMatch(/^\s*```diff$/m);
  });

  it("preserves Persian text and emoji", () => {
    const md = exportMarkdown(
      bundle({
        events: [
          editEvent({ relPath: "src/😀/پرونده.ts" }),
          {
            id: "t1",
            seq: 2,
            sessionId: "s",
            ts: Date.UTC(2026, 10, 21, 9, 7, 0),
            status: "done",
            kind: "terminal",
            command: "echo «سلام» 🎉",
          } as ActivityEvent,
        ],
        diffs: { e1: payload("e1", "@@ -1 +1 @@\n-سلام\n+درود 🚀\n") },
      }),
    );
    expect(md).toContain("پرونده.ts");
    expect(md).toContain("😀");
    expect(md).toContain("echo «سلام» 🎉");
    expect(md).toContain("+درود 🚀");
  });

  it("notes expired, truncated and coarse diffs", () => {
    const md = exportMarkdown(
      bundle({
        events: [editEvent({ id: "gone", seq: 3 }), editEvent({ id: "e1", seq: 1 })],
        diffs: {
          e1: { ...payload(), stat: { added: 1, removed: 1, hunks: 1, truncated: true }, fullAvailable: false },
        },
      }),
    );
    expect(md).toContain("Diff no longer retained");
    expect(md).toContain("Diff truncated");

    const coarse = exportMarkdown(
      bundle({ diffs: { e1: { ...payload(), mode: "coarse", hunks: [] } }, events: [editEvent()] }),
    );
    expect(coarse).toContain("Coarse diff");
  });

  it("renders hunks when no unified text exists", () => {
    const md = exportMarkdown(bundle({ diffs: { e1: { ...payload(), unified: undefined } } }));
    expect(md).toContain("@@ -1,2 +1,2 @@");
    expect(md).toContain("\n-old line");
    expect(md).toContain("\n+new line 👋");
  });

  it("omits absolute paths from the Markdown body", () => {
    const wrong: ActivityEvent = {
      id: "e9",
      seq: 9,
      sessionId: "s",
      ts: 1,
      status: "done",
      kind: "save",
      relPath: "C:/Users/me/secret.ts",
    };
    const md = exportMarkdown(bundle({ events: [wrong] }));
    expect(md).not.toContain("C:/Users/me/secret.ts");
    expect(md).toContain("omitted for privacy");
  });

  it("renders tasks, debug sessions and status", () => {
    const md = exportMarkdown(
      bundle({
        events: [
          {
            id: "task",
            seq: 2,
            sessionId: "s",
            ts: Date.UTC(2026, 10, 21, 9, 8, 0),
            status: "failed",
            kind: "task",
            taskName: "build",
            taskSource: "npm",
            exitCode: 1,
            durationMs: 1_500,
          } as ActivityEvent,
          {
            id: "dbg",
            seq: 3,
            sessionId: "s",
            ts: Date.UTC(2026, 10, 21, 9, 9, 0),
            status: "done",
            kind: "debug",
            debugName: "Run tests",
            debugType: "node",
            debugSessionId: "d1",
            durationMs: 90_000,
          } as ActivityEvent,
        ],
      }),
    );
    expect(md).toContain("Task · build");
    expect(md).toContain("Exit code: 1");
    expect(md).toContain("Status: failed");
    expect(md).toContain("Duration: 1.5 s");
    expect(md).toContain("Debug · Run tests");
    expect(md).toContain("Duration: 1m 30s");
  });

  it("escapes markdown heading characters in paths", () => {
    const md = exportMarkdown(bundle({ events: [editEvent({ relPath: "src/a_b*[c].ts" })] }));
    expect(md).toContain("a\\_b\\*\\[c\\].ts");
  });

  it("handles an empty session", () => {
    const md = exportMarkdown(
      bundle({ events: [], diffs: {}, stats: { ...STATS, events: 0, files: 0, added: 0, removed: 0, durationMs: 0 } }),
    );
    expect(md).toContain("No activity recorded");
    expect(md).toContain("Stats: 0 events");
  });

  it("caps output at 5 MB with a marker", () => {
    const events: ActivityEvent[] = [];
    for (let i = 0; i < 6_000; i += 1) {
      events.push(editEvent({ id: `e${i}`, seq: i + 1, relPath: `src/${"d".repeat(900)}/${i}.ts` }));
    }
    const md = exportMarkdown(bundle({ events, diffs: {} }));
    expect(Buffer.byteLength(md, "utf8")).toBeLessThanOrEqual(EXPORT_MAX_BYTES);
    expect(md).toContain(EXPORT_TRUNCATED_MARKER);
  });
});
