/**
 * Session statistics strip. Counters are isolated from the feed (own memoized cards + CSS grid).
 * The strip always shows session totals — the first and last cards say "Session"/"Duration".
 */
import { memo, useMemo } from "react";
import type { ResolvedLocale, SessionStats } from "../../../src/shared/model";
import { formatDuration, formatNumber } from "../i18n";
import { StatCard } from "./StatCard";
import { useT } from "../app/CodeTrailContext";
import styles from "./StatsStrip.module.css";

export interface StatsStripProps {
  stats: SessionStats;
  locale: ResolvedLocale;
  reducedMotion: boolean;
  compact?: boolean;
  className?: string;
  testId?: string;
}

export const StatsStrip = memo(function StatsStrip({
  stats,
  locale,
  reducedMotion,
  compact = false,
  className,
  testId = "stats-strip",
}: StatsStripProps) {
  const t = useT();
  const fmt = useMemo(
    () => ({
      add: (v: number) => `+${formatNumber(v, locale)}`,
      del: (v: number) => `−${formatNumber(v, locale)}`,
      dur: (v: number) => formatDuration(v, locale),
    }),
    [locale],
  );
  const size = compact ? "sm" : "md";
  return (
    <section
      className={[styles.strip, compact ? styles.compact : "", className ?? ""].filter(Boolean).join(" ")}
      data-testid={testId}
      aria-label={t(compact ? "stats.compactRegion" : "stats.region")}
      data-compact={compact ? "true" : "false"}
    >
      <StatCard label={t("stats.events")} value={stats.events} locale={locale} reducedMotion={reducedMotion} showDelta size={size} index={0} testId="stat-events" />
      <StatCard label={t("stats.files")} value={stats.files} locale={locale} reducedMotion={reducedMotion} size={size} index={1} testId="stat-files" />
      <StatCard label={t("stats.added")} value={stats.added} locale={locale} reducedMotion={reducedMotion} tone="add" format={fmt.add} size={size} index={2} testId="stat-added" />
      <StatCard label={t("stats.removed")} value={stats.removed} locale={locale} reducedMotion={reducedMotion} tone="del" format={fmt.del} size={size} index={3} testId="stat-removed" />
      <StatCard label={t("stats.duration")} value={stats.durationMs} locale={locale} reducedMotion={reducedMotion} format={fmt.dur} size={size} index={4} testId="stat-duration" />
    </section>
  );
});
