/**
 * One statistic: uppercase label, animated value, optional delta chip that appears briefly when
 * the value grows. Counters are isolated so a stats update never re-renders the feed.
 */
import { memo, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ResolvedLocale } from "../../../src/shared/model";
import { formatNumber } from "../i18n";
import { AnimatedNumber } from "./AnimatedNumber";
import styles from "./StatCard.module.css";

export interface StatCardProps {
  label: string;
  value: number;
  locale: ResolvedLocale;
  reducedMotion: boolean;
  format?: (value: number) => string;
  tone?: "default" | "add" | "del" | "accent";
  /** Show `+N` chip when the value grows. */
  showDelta?: boolean;
  deltaLabel?: string;
  index?: number;
  size?: "md" | "sm";
  as?: "article" | "div";
  icon?: ReactNode;
  testId?: string;
  className?: string;
  id?: string;
}

export const StatCard = memo(function StatCard({
  label,
  value,
  locale,
  reducedMotion,
  format,
  tone = "default",
  showDelta = false,
  deltaLabel,
  index = 0,
  size = "md",
  as = "article",
  icon,
  testId = "stat-card",
  className,
  id,
}: StatCardProps) {
  const prev = useRef(value);
  const [delta, setDelta] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const last = prev.current;
    prev.current = value;
    if (!showDelta || value <= last) return;
    setDelta(value - last);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDelta(null), 1200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, showDelta]);

  const classes = [styles.card, styles[size], styles[tone], delta !== null ? styles.updated : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  const Tag = as;
  const style = reducedMotion
    ? undefined
    : ({ animationDelay: `${Math.min(index, 8) * 40}ms` } as CSSProperties);

  return (
    <Tag
      id={id}
      className={[styles.enter, classes].filter(Boolean).join(" ")}
      style={style}
      data-testid={testId}
      data-tone={tone}
      aria-label={label}
    >
      <span className={styles.label}>{label}</span>
      <span className={styles.valueRow}>
        {icon ? <span className={styles.icon}>{icon}</span> : null}
        <AnimatedNumber
          value={value}
          locale={locale}
          reducedMotion={reducedMotion}
          format={format}
          className={styles.value}
          data-testid="stat-value"
        />
        {delta !== null ? (
          <span className={styles.delta} data-testid="stat-delta">
            {deltaLabel ?? `+${formatNumber(delta, locale)}`}
          </span>
        ) : null}
      </span>
    </Tag>
  );
});
