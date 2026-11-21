// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityEvent, DiffPayload } from "../../src/shared/model";
import { DEFAULT_SETTINGS } from "../../src/shared/constants";
import type { Controller } from "../../webview/src/app/CodeTrailContext";
import { CodeTrailProvider } from "../../webview/src/app/CodeTrailContext";
import { initialState } from "../../webview/src/app/store";
import type { AppState } from "../../webview/src/app/store";
import { createTranslator, formatNumber } from "../../webview/src/i18n";
import { DiffBlock } from "../../webview/src/components/DiffBlock";
import { EmptyState } from "../../webview/src/components/EmptyState";
import { EventCard } from "../../webview/src/components/EventCard";
import { Feed } from "../../webview/src/components/Feed";
import { FilterBar } from "../../webview/src/components/FilterBar";
import { HeaderActions } from "../../webview/src/components/HeaderActions";
import { StatsStrip } from "../../webview/src/components/StatsStrip";
import { Toast } from "../../webview/src/components/Toast";

const NOW = 1_700_000_000_000;

interface RenderOptions {
  state?: Partial<AppState>;
  reducedMotion?: boolean;
}

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    ...initialState,
    initialized: true,
    version: "0.1.0",
    surface: "panel",
    settings: { ...DEFAULT_SETTINGS },
    ...overrides,
  };
}

function renderUi(ui: ReactNode, { state, reducedMotion = true }: RenderOptions = {}) {
  const post = vi.fn();
  const dispatch = vi.fn();
  const appState = makeState(state);
  const controller: Controller = {
    state: appState,
    dispatch,
    t: createTranslator(appState.locale),
    surface: appState.surface,
    post,
    now: NOW,
    reducedMotion,
  };
  const result = render(<CodeTrailProvider controller={controller}>{ui}</CodeTrailProvider>);
  return { ...result, post, dispatch, state: appState };
}

function editEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: "e1",
    seq: 3,
    sessionId: "s1",
    ts: NOW - 5_000,
    status: "done",
    kind: "edit",
    relPath: "src/core/diff.ts",
    languageId: "typescript",
    diff: { added: 3, removed: 1, hunks: 1, truncated: false },
    ...overrides,
  } as ActivityEvent;
}

const PAYLOAD: DiffPayload = {
  eventId: "e1",
  hunks: [
    {
      header: "@@ -41,2 +41,3 @@",
      oldStart: 41,
      oldLines: 2,
      newStart: 41,
      newLines: 3,
      lines: [
        { kind: "context", text: "const a = 1;", oldLine: 41, newLine: 41 },
        { kind: "removed", text: "return fast(a);", oldLine: 42 },
        {
          kind: "added",
          text: "return guarded(a);",
          newLine: 42,
          words: [
            { text: "return ", changed: false },
            { text: "guarded", changed: true },
          ],
        },
        { kind: "added", text: "// extra", newLine: 43 },
      ],
    },
  ],
  stat: { added: 3, removed: 1, hunks: 1, truncated: false },
  mode: "exact",
  fullAvailable: true,
  unified: "--- a/src/core/diff.ts\n+++ b/src/core/diff.ts\n@@ -41,2 +41,3 @@",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("EventCard", () => {
  it("renders path, counts and toggles the diff from the header", () => {
    const onToggle = vi.fn();
    const { container } = renderUi(
      <EventCard
        event={editEvent()}
        index={0}
        total={1}
        expanded={false}
        onToggle={onToggle}
        reducedMotion
        now={NOW}
        pendingDiff={false}
        failedDiff={false}
        expiredDiff={false}
        onCopyPath={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("src/core/diff.ts")).toBeInTheDocument();
    expect(screen.getByTestId("event-counts")).toHaveTextContent("+3");
    expect(screen.getByTestId("event-counts")).toHaveTextContent("−1");
    expect(container.querySelector('[data-kind="edit"]')).not.toBeNull();
    fireEvent.click(screen.getByTestId("event-header"));
    expect(onToggle).toHaveBeenCalledWith("e1");
  });

  it("copies the path and opens non-expandable events directly", () => {
    const onCopyPath = vi.fn();
    const onOpen = vi.fn();
    renderUi(
      <EventCard
        event={{ ...editEvent(), id: "s1", kind: "save", seq: 4 } as ActivityEvent}
        index={0}
        total={1}
        expanded={false}
        onToggle={vi.fn()}
        reducedMotion
        now={NOW}
        pendingDiff={false}
        failedDiff={false}
        expiredDiff={false}
        onCopyPath={onCopyPath}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByTestId("event-copy"));
    expect(onCopyPath).toHaveBeenCalledWith("src/core/diff.ts");
    fireEvent.click(screen.getByTestId("event-header"));
    expect(onOpen).toHaveBeenCalledWith("s1");
  });

  it("shows failure status with the exit code and running durations", () => {
    renderUi(
      <EventCard
        event={{
          id: "t1",
          seq: 1,
          sessionId: "s",
          ts: NOW - 1_000,
          status: "failed",
          kind: "task",
          taskName: "npm run build",
          taskSource: "workspace",
          exitCode: 2,
          durationMs: 65_000,
        }}
        index={0}
        total={2}
        expanded={false}
        onToggle={vi.fn()}
        reducedMotion
        now={NOW}
        pendingDiff={false}
        failedDiff={false}
        expiredDiff={false}
        onCopyPath={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByTestId("event-status")).toHaveTextContent("2");
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("names the original path for renames", () => {
    renderUi(
      <EventCard
        event={{
          id: "r1",
          seq: 1,
          sessionId: "s",
          ts: NOW,
          status: "done",
          kind: "file-rename",
          relPath: "docs/new.md",
          fromPath: "notes/old.md",
        }}
        index={0}
        total={1}
        expanded={false}
        onToggle={vi.fn()}
        reducedMotion
        now={NOW}
        pendingDiff={false}
        failedDiff={false}
        expiredDiff={false}
        onCopyPath={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText(/notes\/old\.md/)).toBeInTheDocument();
  });
});

describe("DiffBlock", () => {
  const base = {
    eventId: "e1",
    relPath: "src/core/diff.ts",
    pending: false,
    failed: false,
    expired: false,
  };

  it("renders hunks with word marks and copies the unified diff", () => {
    const { post } = renderUi(<DiffBlock {...base} payload={PAYLOAD} />);
    expect(screen.getByTestId("diff-code")).toBeInTheDocument();
    expect(screen.getByText("@@ -41,2 +41,3 @@")).toBeInTheDocument();
    expect(screen.getByText("guarded")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("diff-copy"));
    expect(post).toHaveBeenCalledWith({ type: "copy", text: PAYLOAD.unified });
  });

  it("renders code in the compact sidebar variant too", () => {
    renderUi(<DiffBlock {...base} payload={PAYLOAD} compact />);
    expect(screen.getByTestId("diff-code")).toBeInTheDocument();
  });

  it("shows the three terminal states", () => {
    const expired = renderUi(<DiffBlock {...base} payload={undefined} expired />);
    expect(expired.getByTestId("diff-expired")).toBeInTheDocument();
    expired.unmount();

    const pending = renderUi(<DiffBlock {...base} payload={undefined} pending />);
    expect(pending.getByTestId("diff-skeleton")).toBeInTheDocument();
    pending.unmount();

    const failed = renderUi(<DiffBlock {...base} payload={undefined} failed />);
    fireEvent.click(failed.getByText(/retry/i));
    expect(failed.post).toHaveBeenCalledWith({ type: "requestDiff", id: "e1" });
  });

  it("summarizes coarse diffs with before/after excerpts", () => {
    const coarse: DiffPayload = {
      ...PAYLOAD,
      mode: "coarse",
      hunks: [
        {
          ...PAYLOAD.hunks[0],
          lines: [
            { kind: "removed", text: "old line", oldLine: 1 },
            { kind: "added", text: "new line", newLine: 1 },
          ],
        },
      ],
    };
    renderUi(<DiffBlock {...base} payload={coarse} />);
    expect(screen.getByTestId("diff-block")).toHaveAttribute("data-mode", "coarse");
    expect(screen.getByTestId("diff-coarse-before")).toHaveTextContent("old line");
    expect(screen.getByTestId("diff-coarse-after")).toHaveTextContent("new line");
  });
});

describe("FilterBar", () => {
  const props = {
    kinds: [] as ActivityEvent["kind"][],
    timeRange: "session" as const,
    query: "",
    resultCount: 4,
    onQueryChange: vi.fn(),
  };

  it("adds every member of the files group", () => {
    const { dispatch } = renderUi(<FilterBar {...props} />);
    fireEvent.click(screen.getByTestId("filter-chip-files"));
    expect(dispatch).toHaveBeenCalledWith({
      type: "setKinds",
      kinds: ["save", "file-create", "file-delete", "file-rename", "file-change"],
    });
  });

  it("removes a selected group only", () => {
    const { dispatch } = renderUi(<FilterBar {...props} kinds={["edit", "task"]} />);
    fireEvent.click(screen.getByTestId("filter-chip-edit"));
    expect(dispatch).toHaveBeenCalledWith({ type: "setKinds", kinds: ["task"] });
  });

  it("changes the time range and forwards search input", () => {
    const onQueryChange = vi.fn();
    const { dispatch } = renderUi(<FilterBar {...props} onQueryChange={onQueryChange} />);
    fireEvent.change(screen.getByTestId("filter-time"), { target: { value: "1h" } });
    expect(dispatch).toHaveBeenCalledWith({ type: "setTimeRange", timeRange: "1h" });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "diff" } });
    expect(onQueryChange).toHaveBeenCalledWith("diff");
  });
});

describe("HeaderActions", () => {
  it("opens the overflow menu and posts export requests", () => {
    const { post } = renderUi(<HeaderActions surface="panel" onClear={vi.fn()} />);
    fireEvent.click(screen.getByTestId("header-more"));
    expect(screen.getByTestId("header-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("menu-export-json"));
    expect(post).toHaveBeenCalledWith({ type: "export", format: "json" });
    expect(screen.queryByTestId("header-menu")).not.toBeInTheDocument();
  });

  it("offers the full panel from the sidebar", () => {
    const { post } = renderUi(<HeaderActions surface="sidebar" onClear={vi.fn()} />);
    fireEvent.click(screen.getByTestId("header-more"));
    fireEvent.click(screen.getByTestId("menu-open-panel"));
    expect(post).toHaveBeenCalledWith({ type: "openPanel" });
  });

  it("closes on Escape and restores focus to the trigger", () => {
    renderUi(<HeaderActions surface="panel" onClear={vi.fn()} />);
    const trigger = screen.getByTestId("header-more");
    fireEvent.click(trigger);
    expect(screen.getByTestId("header-menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("header-menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("routes the clear item to the native confirmation", () => {
    const onClear = vi.fn();
    renderUi(<HeaderActions surface="panel" onClear={onClear} />);
    fireEvent.click(screen.getByTestId("header-more"));
    fireEvent.click(screen.getByTestId("menu-clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("Toast", () => {
  it("auto-dismisses after four seconds", () => {
    vi.useFakeTimers();
    const { dispatch } = renderUi(<Toast toast={{ id: 1, level: "info", message: "saved" }} />);
    expect(screen.getByText("saved")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(dispatch).toHaveBeenCalledWith({ type: "dismissToast" });
  });
});

describe("EmptyState", () => {
  it("renders each variant and invokes its action", () => {
    const onAction = vi.fn();
    renderUi(<EmptyState variant="filtered" onAction={onAction} />);
    expect(screen.getByTestId("empty-state-filtered")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("empty-action"));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe("Feed", () => {
  it("renders the empty state instead of virtual rows when there are no events", () => {
    const onAction = vi.fn();
    renderUi(
      <Feed
        events={[]}
        hasMore={false}
        olderPending={false}
        emptyVariant="first-run"
        onEmptyAction={onAction}
        testId="feed"
      />,
    );
    expect(screen.getByTestId("feed")).toHaveAttribute("data-empty", "true");
    expect(screen.getByTestId("empty-action")).toBeInTheDocument();
  });
});

describe("StatsStrip", () => {
  it("localizes counters and durations for Persian", () => {
    renderUi(
      <StatsStrip
        stats={{ events: 12, files: 4, added: 5, removed: 2, sessionStartedAt: 0, durationMs: 65_000 }}
        locale="fa"
        reducedMotion
      />,
      { state: { locale: "fa", direction: "rtl" } },
    );
    expect(screen.getByTestId("stat-added")).toHaveTextContent(`+${formatNumber(5, "fa")}`);
    expect(screen.getByTestId("stat-duration")).toHaveTextContent("۱:۰۵");
  });
});
