/**
 * Type chips (`aria-pressed`), native time-range `<select>` and the search field.
 * `compact` (sidebar) collapses everything behind a single "Filters (n)" popover.
 * `kinds` is the flattened union of the selected groups, matching `Filters.kinds`.
 */
import { useEffect, useId, useRef } from "react";
import type { EventKind, TimeRange } from "../../../src/shared/model";
import { useDispatch, useT } from "../app/CodeTrailContext";
import { kindsInGroup } from "../app/selectors";
import { CloseIcon, FilterIcon } from "./Icons";
import { SearchField } from "./SearchField";
import common from "../styles/common.module.css";
import styles from "./FilterBar.module.css";

export const FILTER_GROUPS = [
  { key: "all", kinds: [] as EventKind[] },
  { key: "edit", kinds: ["edit"] },
  { key: "files", kinds: ["save", "file-create", "file-delete", "file-rename", "file-change"] },
  { key: "tasks", kinds: ["task"] },
  { key: "debug", kinds: ["debug"] },
  { key: "exec", kinds: ["terminal"] },
] as const;

export type FilterGroupKey = (typeof FILTER_GROUPS)[number]["key"];

const GROUP_KEYS: Record<FilterGroupKey, readonly EventKind[]> = {
  all: [],
  edit: kindsInGroup("edit"),
  files: kindsInGroup("files"),
  tasks: kindsInGroup("tasks"),
  debug: kindsInGroup("debug"),
  exec: kindsInGroup("exec"),
};

const LABEL_KEYS = {
  all: "filter.all",
  edit: "filter.edit",
  files: "filter.files",
  tasks: "filter.tasks",
  debug: "filter.debug",
  exec: "filter.exec",
} as const;

export function isGroupSelected(group: FilterGroupKey, kinds: EventKind[]): boolean {
  const members = GROUP_KEYS[group];
  if (members.length === 0) return kinds.length === 0;
  return members.every((kind) => kinds.includes(kind));
}

export interface FilterBarProps {
  kinds: EventKind[];
  timeRange: TimeRange;
  query: string;
  resultCount: number;
  compact?: boolean;
  panelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
  onQueryChange: (query: string) => void;
  className?: string;
}

export function FilterBar({
  kinds,
  timeRange,
  query,
  resultCount,
  compact = false,
  panelOpen = false,
  onPanelOpenChange,
  onQueryChange,
  className,
}: FilterBarProps) {
  const t = useT();
  const dispatch = useDispatch();
  const selectId = useId();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const activeGroups = FILTER_GROUPS.filter((g) => g.key !== "all" && isGroupSelected(g.key, kinds)).length;
  const activeCount = activeGroups + (timeRange !== "session" ? 1 : 0);

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onPanelOpenChange?.(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelOpen, onPanelOpenChange]);

  const toggleGroup = (group: FilterGroupKey) => {
    if (group === "all") {
      dispatch({ type: "clearKinds" });
      return;
    }
    const members = GROUP_KEYS[group];
    if (isGroupSelected(group, kinds)) {
      // Removing a group removes only its members (keeps other selections intact).
      dispatch({ type: "setKinds", kinds: kinds.filter((k) => !members.includes(k)) });
    } else {
      const next = [...kinds];
      for (const member of members) if (!next.includes(member)) next.push(member);
      dispatch({ type: "setKinds", kinds: next });
    }
  };

  const chips = (
    <div className={styles.chips} role="group" aria-label={t("filter.groupLabel")} data-testid="filter-chips">
      {FILTER_GROUPS.map((group) => {
        const pressed = isGroupSelected(group.key, kinds);
        return (
          <button
            key={group.key}
            type="button"
            className={[styles.chip, pressed ? styles.selected : ""].join(" ")}
            aria-pressed={pressed}
            data-testid={`filter-chip-${group.key}`}
            onClick={() => toggleGroup(group.key)}
          >
            {t(LABEL_KEYS[group.key])}
          </button>
        );
      })}
    </div>
  );

  const timeSelect = (
    <div className={styles.timeWrap}>
      <label className="sr-only" htmlFor={selectId}>
        {t("filter.timeLabel")}
      </label>
      <select
        id={selectId}
        className={styles.select}
        value={timeRange}
        data-testid="filter-time"
        onChange={(event) => dispatch({ type: "setTimeRange", timeRange: event.target.value as TimeRange })}
      >
        <option value="session">{t("filter.time.session")}</option>
        <option value="5m">{t("filter.time.5m")}</option>
        <option value="1h">{t("filter.time.1h")}</option>
      </select>
    </div>
  );

  const search = (
    <SearchField
      value={query}
      onChange={onQueryChange}
      resultCount={resultCount}
      compact={compact}
      className={styles.search}
      autoFocus={compact && panelOpen}
    />
  );

  if (compact) {
    return (
      <div className={[styles.compactBar, className ?? ""].filter(Boolean).join(" ")} data-testid="filter-bar">
        <button
          ref={triggerRef}
          type="button"
          className={[common.ghostButton, styles.trigger].join(" ")}
          aria-expanded={panelOpen}
          aria-controls="lp-filter-popover"
          data-testid="filter-trigger"
          onClick={() => onPanelOpenChange?.(!panelOpen)}
        >
          <FilterIcon size={13} />
          <span>{t("filter.open", { count: activeCount })}</span>
        </button>
        {panelOpen ? (
          <div
            id="lp-filter-popover"
            ref={popoverRef}
            className={styles.popover}
            data-testid="filter-popover"
            role="dialog"
            aria-label={t("filter.open", { count: activeCount })}
          >
            {chips}
            <div className={styles.row}>
              {timeSelect}
              <button
                type="button"
                className={common.iconButton}
                aria-label={t("filter.close")}
                onClick={() => {
                  onPanelOpenChange?.(false);
                  triggerRef.current?.focus();
                }}
              >
                <CloseIcon size={12} />
              </button>
            </div>
            {search}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={[styles.bar, className ?? ""].filter(Boolean).join(" ")} data-testid="filter-bar">
      {chips}
      <div className={styles.right}>
        {timeSelect}
        {search}
      </div>
    </div>
  );
}
