/**
 * Virtualized activity feed shared by the panel and the sidebar (density differs, code does not).
 *
 * - `@tanstack/react-virtual` with dynamic measurement: expanded cards change height, so every
 *   card gets `ref={measureElement}` and the row estimate only seeds the first pass;
 * - at most `mountedVisible` cards mount (≤ 40 by default) even with 1,000+ events;
 * - new events while scrolled away never move the scroll position (the list keeps the previous
 *   offset); while at the top the newest event stays visible;
 * - reaching the end asks the host for older pages (`requestOlder` with the oldest seq);
 * - `role="feed"` + one hidden coalesced announcer, no per-keystroke live regions.
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ActivityEvent, DiffPayload } from "../../../src/shared/model";
import { LIMITS } from "../../../src/shared/constants";
import { useController, useT } from "../app/CodeTrailContext";
import { useCoalescedAnnouncer, useDebounced } from "../app/hooks";
import { EventCard } from "./EventCard";
import { EmptyState } from "./EmptyState";
import common from "../styles/common.module.css";
import styles from "./Feed.module.css";

export interface FeedProps {
  events: ActivityEvent[];
  hasMore: boolean;
  olderPending: boolean;
  compact?: boolean;
  initialAnchor?: number;
  /** Forwarded so the surface can reset the scroll position to "newest". */
  scrollToTopRef?: React.RefObject<(() => void) | null>;
  /** Notified with the first visible row index (used for state persistence). */
  onAnchorChange?: (anchor: number) => void;
  onVisibleTopChange?: (atTop: boolean) => void;
  emptyVariant: "first-run" | "filtered" | "cleared";
  onEmptyAction: () => void;
  emptySecondary?: React.ReactNode;
  emptyRef?: React.Ref<HTMLDivElement>;
  paused?: boolean;
  testId?: string;
}

const AT_TOP_PX = 120;

export function Feed({
  events,
  hasMore,
  olderPending,
  compact = false,
  initialAnchor = 0,
  scrollToTopRef,
  onAnchorChange,
  onVisibleTopChange,
  emptyVariant,
  onEmptyAction,
  emptySecondary,
  emptyRef,
  paused = false,
  testId = "feed",
}: FeedProps) {
  const t = useT();
  const { state, dispatch, post, reducedMotion, now } = useController();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const mountedVisible = Math.min(compact ? 24 : LIMITS.mountedCardBudget, LIMITS.mountedCardBudget);
  const estimate = compact ? 56 : 64;

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimate,
    overscan: 6,
    getItemKey: (index) => events[index]?.id ?? index,
    rangeExtractor: (range) => {
      const start = Math.max(0, range.startIndex - range.overscan);
      const end = Math.min(
        range.endIndex + range.overscan,
        start + mountedVisible - 1,
        events.length - 1,
      );
      const keys: number[] = [];
      for (let i = start; i <= end; i++) keys.push(i);
      return keys;
    },
  });

  const [queryNow, setQueryNow] = useState(now);
  const debouncedQuery = useDebounced(state.filters.query.trim(), 180);
  useEffect(() => setQueryNow(now), [debouncedQuery, now]);

  // Announcements
  const announcer = useCoalescedAnnouncer(5000);
  const lastAnnouncedSeq = useRef<number | null>(null);
  const newest = events[0];
  useEffect(() => {
    if (!newest) return;
    if (paused) {
      lastAnnouncedSeq.current = newest.seq;
      return;
    }
    if (lastAnnouncedSeq.current === null) {
      lastAnnouncedSeq.current = newest.seq;
      return;
    }
    if (newest.seq > lastAnnouncedSeq.current) {
      lastAnnouncedSeq.current = newest.seq;
      const pending = state.newActivityCount > 0 ? state.newActivityCount : 1;
      announcer.push(
        pending === 1 ? t("feed.newActivityOne") : t("feed.newActivity", { count: pending }),
      );
    }
  }, [newest, paused, announcer, state.newActivityCount, t]);

  const prevPaused = useRef(paused);
  useEffect(() => {
    if (prevPaused.current !== paused) {
      prevPaused.current = paused;
      announcer.flush();
    }
  }, [paused, announcer]);

  // Scroll position handling
  const lastTopIndex = useRef(0);
  const firstRun = useRef(true);

  const atTop = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollTop <= AT_TOP_PX;
  }, []);

  const olderInFlight = useRef(false);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = !atTop();
    if (state.scrolledAway !== next) {
      dispatch({ type: "scrolledAway", value: next });
      onVisibleTopChange?.(!next);
    }
    const firstVisible = virtualizer.getVirtualItems()[0];
    lastTopIndex.current = firstVisible ? firstVisible.index : 0;
    if (onAnchorChange) {
      onAnchorChange(lastTopIndex.current);
    }
    if (
      hasMore &&
      !olderPending &&
      !olderInFlight.current &&
      el.scrollHeight - el.scrollTop - el.clientHeight < estimate * 3
    ) {
      const oldestSeq = events.length > 0 ? events[events.length - 1].seq : -1;
      if (oldestSeq >= 0) {
        olderInFlight.current = true;
        dispatch({ type: "olderRequested" });
        post({ type: "requestOlder", beforeSeq: oldestSeq });
      }
    }
  }, [atTop, state.scrolledAway, dispatch, onVisibleTopChange, onAnchorChange, hasMore, olderPending, estimate, events, post, virtualizer]);

  useEffect(() => {
    if (!olderPending) olderInFlight.current = false;
  }, [olderPending]);

  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;
  const stableOnScroll = useCallback(() => {
    onScrollRef.current();
  }, []);

  // Restore the scroll anchor once (persisted UI state).
  useLayoutEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (initialAnchor > 0 && scrollRef.current) {
        // Rows are estimated until measured, so no precise scroll maths is needed here.
        scrollRef.current.scrollTop = initialAnchor * estimate;
        onVisibleTopChange?.(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!scrollToTopRef) return;
    scrollToTopRef.current = () => {
      const el = scrollRef.current;
      if (el) el.scrollTop = 0;
      dispatch({ type: "newActivityVisible" });
      onVisibleTopChange?.(true);
    };
    return () => {
      scrollToTopRef.current = null;
    };
  }, [scrollToTopRef, dispatch, onVisibleTopChange]);

  // While the user is at the top, keep the newest event visible as cards are prepended.
  const prevCount = useRef(events.length);
  useLayoutEffect(() => {
    const grew = events.length > prevCount.current;
    prevCount.current = events.length;
    if (!grew) return;
    if (!state.scrolledAway) {
      const el = scrollRef.current;
      if (el) el.scrollTop = 0;
    }
  }, [events.length, state.scrolledAway]);

  const items = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();
  const lastItem = items[items.length - 1];
  const tailVisible = events.length > 0 && lastItem && lastItem.index >= events.length - 1;

  const handleToggle = useCallback(
    (id: string) => {
      if (state.expanded.includes(id)) dispatch({ type: "collapse", id });
      else dispatch({ type: "expand", id });
    },
    [state.expanded, dispatch],
  );

  const onOpen = useCallback((id: string) => post({ type: "open", id }), [post]);
  const onCopy = useCallback((text: string) => post({ type: "copy", text }), [post]);

  const diffs = state.diffs;
  const pendingIds = state.pendingDiffIds;
  const failedIds = state.failedDiffIds;
  const expiredIds = state.expiredDiffIds;
  const expanded = state.expanded;

  const rows = useMemo(
    () =>
      items.map((item) => {
        const event = events[item.index];
        if (!event) return null;
        const payload: DiffPayload | undefined = diffs[event.id];
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className={styles.row}
            style={{
              position: "absolute",
              insetBlockStart: 0,
              insetInlineStart: 0,
              width: "100%",
              transform: `translateY(${item.start}px)`,
            }}
          >
            <EventCard
              event={event}
              index={item.index}
              total={events.length}
              expanded={expanded.includes(event.id)}
              onToggle={handleToggle}
              compact={compact}
              reducedMotion={reducedMotion}
              now={queryNow}
              payload={payload}
              pendingDiff={pendingIds.includes(event.id)}
              failedDiff={failedIds.includes(event.id)}
              expiredDiff={expiredIds.includes(event.id)}
              onCopyPath={onCopy}
              onOpen={onOpen}
              data-index={item.index}
            />
          </div>
        );
      }),
    [items, events, diffs, pendingIds, failedIds, expiredIds, expanded, handleToggle, compact, reducedMotion, queryNow, onCopy, onOpen, virtualizer.measureElement],
  );

  if (events.length === 0) {
    return (
      <div className={styles.emptyHost} data-testid={testId} data-empty="true">
        <EmptyState
          ref={emptyRef}
          variant={emptyVariant}
          onAction={onEmptyAction}
          secondary={emptySecondary}
          compact={compact}
        />
      </div>
    );
  }

  return (
    <div className={styles.host} data-testid={testId} data-scrolled-away={state.scrolledAway ? "true" : "false"}>
      <div
        ref={scrollRef}
        className={["scroll-styled", styles.scroll, paused ? styles.pausedLed : ""].filter(Boolean).join(" ")}
        onScroll={stableOnScroll}
        data-testid="feed-scroll"
        tabIndex={0}
        aria-label={t("feed.label")}
      >
        <div role="feed" aria-busy={olderPending} aria-label={t("feed.label")} className={styles.feed}>
          <div style={{ height: total, position: "relative", width: "100%" }}>{rows}</div>
        </div>
        <div className={styles.tail} aria-live="polite">
          {tailVisible && (hasMore || olderPending) ? (
            <span data-testid="feed-more" className={common.muted}>
              {olderPending ? t("feed.moreLoading") : t("feed.more", { count: "⋯" })}
            </span>
          ) : null}
        </div>
      </div>
      <span className="sr-only" aria-live="polite" aria-atomic="true" data-testid="feed-announcer">
        {announcer.text}
      </span>
    </div>
  );
}
