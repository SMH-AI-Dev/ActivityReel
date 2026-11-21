/**
 * Editor panel surface: hero (version + live/pause badge + actions), paused banner, stat strip
 * (5-up), filter bar, virtualized feed, new-activity pill and the signature footer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useController, useT } from "../app/ActivityReelContext";
import { hasActiveFilters } from "../app/selectors";
import { livenessOf } from "../components/LiveBadge";
import { LiveBadge } from "../components/LiveBadge";
import { Hero } from "../components/Hero";
import { StatsStrip } from "../components/StatsStrip";
import { FilterBar } from "../components/FilterBar";
import { Feed } from "../components/Feed";
import { PausedState } from "../components/PausedState";
import { NewActivityPill } from "../components/NewActivityPill";
import { HeaderActions } from "../components/HeaderActions";
import { Footer } from "../components/Footer";
import { useFilteredEvents, useFilterPanel, useFilterSync, useLastEventTs } from "./shared";
import styles from "./Panel.module.css";

export function Panel() {
  const t = useT();
  const { state, dispatch, post, reducedMotion, now } = useController();
  const { events } = useFilteredEvents();
  const lastTs = useLastEventTs();
  const [filterOpen, setFilterOpen] = useFilterPanel();
  useFilterSync();

  const scrollTopRef = useRef<(() => void) | null>(null);
  const emptyRef = useRef<HTMLDivElement | null>(null);
  const [pulse, setPulse] = useState(false);
  const prevLatest = useRef(state.latestSeq);

  useEffect(() => {
    if (state.latestSeq > prevLatest.current) {
      prevLatest.current = state.latestSeq;
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 1600);
      return () => clearTimeout(timer);
    }
    prevLatest.current = state.latestSeq;
    return undefined;
  }, [state.latestSeq]);

  useEffect(() => {
    if (state.justCleared) emptyRef.current?.focus();
  }, [state.justCleared]);

  const liveness = livenessOf(state.paused, lastTs, now);

  const togglePause = useCallback(() => {
    // The host answers with a state update and an announcement toast.
    post({ type: "pause", value: !state.paused });
  }, [state.paused, post]);

  const clear = useCallback(() => {
    // The host confirms natively; the webview only asks.
    post({ type: "clear" });
  }, [post]);

  const emptyVariant = useMemo(() => {
    if (state.events.length === 0) return state.justCleared ? "cleared" : "first-run";
    return "filtered";
  }, [state.events.length, state.justCleared]);

  const filtered = hasActiveFilters(state);

  const onEmptyAction = useCallback(() => {
    if (emptyVariant === "filtered") dispatch({ type: "clearFilters" });
    else if (emptyVariant === "cleared") dispatch({ type: "clearReset" });
    else post({ type: "openAbout" });
  }, [emptyVariant, dispatch, post]);

  return (
    <div className={styles.surface} data-testid="surface-panel">
      <main className={styles.main}>
        <div className={styles.content}>
          <Hero
            version={state.version}
            paused={state.paused}
            degraded={false}
            size="lg"
            pulse={pulse}
          >
            <LiveBadge liveness={state.paused ? "paused" : liveness} asButton onToggle={togglePause} data-testid="live-badge" />
            <HeaderActions surface="panel" onClear={clear} />
          </Hero>

          {state.paused ? (
            <PausedState
              onResume={() => {
                post({ type: "pause", value: false });
              }}
            />
          ) : null}

          <StatsStrip
            stats={state.stats}
            locale={state.locale}
            reducedMotion={reducedMotion}
            className={styles.stats}
          />

          <FilterBar
            kinds={state.filters.kinds}
            timeRange={state.filters.timeRange}
            query={state.filters.query}
            resultCount={events.length}
            panelOpen={filterOpen}
            onPanelOpenChange={setFilterOpen}
            onQueryChange={(query) => dispatch({ type: "setQuery", query })}
          />

          <div className={styles.feedArea}>
            {state.initialized ? (
              <Feed
                key={state.justCleared ? "cleared" : "feed"}
                events={events}
                hasMore={state.hasMore}
                olderPending={state.olderPending}
                initialAnchor={state.scrollAnchor}
                scrollToTopRef={scrollTopRef}
                onAnchorChange={(anchor) => dispatch({ type: "setScrollAnchor", anchor })}
                emptyVariant={emptyVariant}
                onEmptyAction={onEmptyAction}
                emptyRef={emptyRef}
                paused={state.paused}
                testId="feed"
              />
            ) : (
              <FeedSkeleton label={t("feed.moreLoading")} />
            )}
            {filtered ? (
              <div className={styles.filterHint}>
                <button
                  type="button"
                  className={styles.clearFilters}
                  onClick={() => dispatch({ type: "clearFilters" })}
                  data-testid="clear-filters-inline"
                >
                  {t("filter.clear")}
                </button>
              </div>
            ) : null}
            <NewActivityPill
              count={state.scrolledAway ? state.newActivityCount : 0}
              onClick={() => scrollTopRef.current?.()}
            />
          </div>
        </div>
      </main>
      <Footer onAbout={() => post({ type: "openAbout" })} />
    </div>
  );
}

function FeedSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.skeletonList} aria-busy="true" data-testid="feed-skeleton">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.skeletonCard} />
      ))}
    </div>
  );
}
