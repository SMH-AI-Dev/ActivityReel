import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../../src/shared/model";
import {
  eventHaystack,
  hasActiveFilters,
  kindsInGroup,
  matchesFilters,
  selectVisibleEvents,
} from "../../webview/src/app/selectors";
import { initialState } from "../../webview/src/app/store";

const now = 1_700_000_000_000;

const edit: ActivityEvent = {
  id: "edit",
  seq: 4,
  sessionId: "s",
  ts: now - 1_000,
  status: "done",
  kind: "edit",
  relPath: "src/Core/Store.ts",
  diff: { added: 1, removed: 0, hunks: 1, truncated: false },
  searchText: "guarded(myers)",
};

const rename: ActivityEvent = {
  id: "rename",
  seq: 3,
  sessionId: "s",
  ts: now - 10 * 60_000,
  status: "done",
  kind: "file-rename",
  relPath: "docs/new.md",
  fromPath: "notes/old.md",
};

const task: ActivityEvent = {
  id: "task",
  seq: 2,
  sessionId: "s",
  ts: now - 2 * 60 * 60_000,
  status: "failed",
  kind: "task",
  taskName: "npm run build",
  taskSource: "workspace",
};

const terminal: ActivityEvent = {
  id: "terminal",
  seq: 1,
  sessionId: "s",
  ts: now - 3_000,
  status: "done",
  kind: "terminal",
  command: "git status --short",
  cwd: "packages/app",
};

const events = [edit, rename, task, terminal];

function select(kinds: ActivityEvent["kind"][] = [], query = "", timeRange: "session" | "5m" | "1h" = "session") {
  return selectVisibleEvents(
    { ...initialState, events, filters: { kinds, query, timeRange } },
    now,
  );
}

describe("selectVisibleEvents", () => {
  it("returns the original list when nothing is filtered", () => {
    expect(select()).toBe(events);
  });

  it("filters by kind", () => {
    expect(select(["task"]).map((event) => event.id)).toEqual(["task"]);
  });

  it("matches queries against paths, rename origins, tasks and terminal context", () => {
    expect(select([], "core/store").map((event) => event.id)).toEqual(["edit"]);
    expect(select([], "notes/old").map((event) => event.id)).toEqual(["rename"]);
    expect(select([], "build").map((event) => event.id)).toEqual(["task"]);
    expect(select([], "packages/app").map((event) => event.id)).toEqual(["terminal"]);
  });

  it("trims and lowercases the query before matching", () => {
    expect(select([], "  MYERS  ").map((event) => event.id)).toEqual(["edit"]);
  });

  it("applies relative time ranges against the supplied clock", () => {
    expect(select([], "", "5m").map((event) => event.id)).toEqual(["edit", "terminal"]);
    expect(select([], "", "1h").map((event) => event.id)).toEqual(["edit", "rename", "terminal"]);
  });

  it("combines kind, query and range", () => {
    expect(select(["terminal"], "git", "5m").map((event) => event.id)).toEqual(["terminal"]);
    expect(select(["terminal"], "git", "1h")).toHaveLength(1);
  });
});

describe("eventHaystack", () => {
  it("includes secondary identifiers per kind", () => {
    expect(eventHaystack(rename)).toContain("notes/old.md");
    expect(eventHaystack(task)).toContain("workspace");
    expect(eventHaystack(terminal)).toContain("git status");
    expect(eventHaystack(edit)).toContain("guarded(myers)");
  });
});

describe("matchesFilters", () => {
  it("keeps events when every filter is inactive", () => {
    expect(
      matchesFilters(edit, { kinds: [], queryLower: "", range: "session", now }),
    ).toBe(true);
  });
});

describe("hasActiveFilters", () => {
  it("detects each filter dimension and ignores whitespace queries", () => {
    expect(hasActiveFilters(initialState)).toBe(false);
    expect(
      hasActiveFilters({ ...initialState, filters: { kinds: ["edit"], query: "", timeRange: "session" } }),
    ).toBe(true);
    expect(
      hasActiveFilters({ ...initialState, filters: { kinds: [], query: "  ", timeRange: "session" } }),
    ).toBe(false);
    expect(
      hasActiveFilters({ ...initialState, filters: { kinds: [], query: "x", timeRange: "session" } }),
    ).toBe(true);
    expect(
      hasActiveFilters({ ...initialState, filters: { kinds: [], query: "", timeRange: "5m" } }),
    ).toBe(true);
  });
});

describe("kindsInGroup", () => {
  it("returns the declared members and empty for unknown groups", () => {
    expect(kindsInGroup("files")).toEqual(["save", "file-create", "file-delete", "file-rename", "file-change"]);
    expect(kindsInGroup("unknown")).toEqual([]);
  });
});
