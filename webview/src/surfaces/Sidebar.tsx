/**
 * Activity Bar sidebar surface (300–500 px): compact header (OrbitMark sm + title + count),
 * 28 px live badge row (static `<span>`, pause is a title-bar command), 2×2 stats strip,
 * collapsible filter bar, compact virtualized cards, new-activity pill and a compact footer.
 */
import { useCallback, useEffect, useRef } from "react";
import { useController, useT } from "../app/ActivityReelContext";
import { hasActiveFilters } from "../app/selectors";
import { livenessOf, LiveBadge } from "../components/LiveBadge";
import { OrbitMark } from "../components/OrbitMark";
import { StatsStrip } from "../components/StatsStrip";
import { FilterBar } from "../components/FilterBar";
import { Feed } from "../components/Feed";
import { NewActivityPill } from "../components/NewActivityPill";
import { HeaderActions } from "../components/HeaderActions";
import { Footer } from "../components/Footer";
import { useFilteredEvents, useFilterPanel, useFilterSync, useLastEventTs } from "./shared";
import styles from "./Sidebar.module.css";

export function Sidebar() {
  const t = useT();
  const { state, dispatch, post, reducedMotion, now } = useController();
  const { events } = useFilteredEvents();
  const lastTs = useLastEventTs();
  const [filterOpen, setFilterOpen] = useFilterPanel();
  useFilterSync();

  const scrollTopRef = useRef<(() => void) | null>(null);
  const emptyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (state.justCleared) emptyRef.current?.focus();
  }, [state.justCleared]);

  const emptyVariant =
    state.events.length === 0 ? (state.justCleared ? "cleared" : "first-run") : "filtered";

  const onEmptyAction = useCallback(() => {
    if (emptyVariant === "filtered") dispatch({ type: "clearFilters" });
    else if (emptyVariant === "cleared") dispatch({ type: "clearReset" });
    else post({ type: "openAbout" });
  }, [emptyVariant, dispatch, post]);

  return (
    <div className={styles.surface} data-testid="surface-sidebar">
      <header className={styles.header}>
        <OrbitMark
          size="sm"
          state={state.paused ? "paused" : "live"}
          label={state.paused ? t("hero.orbitPausedLabel") : t("hero.orbitLabel")}
        />
        <h1 className={styles.title}>{t("hero.product")}</h1>
        <span className={styles.count} data-testid="header-count" dir="ltr" aria-label={t("stats.events")}>
          {new Intl.NumberFormat(state.locale === "fa" ? "fa-IR" : "en").format(state.stats.events)}
        </span>
        <HeaderActions
          surface="sidebar"
          onClear={() => {
            post({ type: "clear" });
          }}
        />
      </header>

      <div className={styles.badgeRow}>
        <LiveBadge liveness={livenessOf(state.paused, lastTs, now)} />
        <span className={styles.sessionLabel}>{t("badge.session")}</span>
      </div>

      <StatsStrip
        stats={state.stats}
        locale={state.locale}
        reducedMotion={reducedMotion}
        compact
        className={styles.stats}
      />

      <div className={styles.filters}>
        <FilterBar
          compact
          kinds={state.filters.kinds}
          timeRange={state.filters.timeRange}
          query={state.filters.query}
          resultCount={events.length}
          panelOpen={filterOpen}
          onPanelOpenChange={setFilterOpen}
          onQueryChange={(query) => dispatch({ type: "setQuery", query })}
        />
      </div>

      <div className={styles.feedArea}>
        {state.initialized ? (
          <Feed
            key={state.justCleared ? "cleared" : "feed"}
            compact
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
          <div className={styles.skeletonList} aria-busy="true" data-testid="feed-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={styles.skeletonCard} />
            ))}
          </div>
        )}
        {hasActiveFilters(state) ? (
          <button
            type="button"
            className={styles.clearFilters}
            onClick={() => dispatch({ type: "clearFilters" })}
            data-testid="clear-filters-inline"
          >
            {t("filter.clear")}
          </button>
        ) : null}
        <NewActivityPill
          count={state.scrolledAway ? state.newActivityCount : 0}
          onClick={() => scrollTopRef.current?.()}
        />
      </div>

      <Footer compact onAbout={() => post({ type: "openAbout" })} />
    </div>
  );
}
