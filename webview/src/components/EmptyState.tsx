/**
 * Centered empty state: OrbitMark at 30 % + one sentence + one action.
 * Variants: first-run, filtered-empty, cleared (focusable so `cleared` can move focus here).
 */
import { forwardRef } from "react";
import type { ReactNode } from "react";
import { useController, useT } from "../app/CodeTrailContext";
import { OrbitMark } from "./OrbitMark";
import common from "../styles/common.module.css";
import styles from "./EmptyState.module.css";

export type EmptyVariant = "first-run" | "filtered" | "cleared";

export interface EmptyStateProps {
  variant: EmptyVariant;
  onAction: () => void;
  /** Optional secondary link (first-run "Open README"). */
  secondary?: ReactNode;
  compact?: boolean;
}

const TITLES = {
  "first-run": "empty.firstRun.title",
  filtered: "empty.filtered.title",
  cleared: "empty.cleared.title",
} as const;

const BODIES = {
  "first-run": "empty.firstRun.body",
  filtered: "empty.filtered.body",
  cleared: "empty.cleared.body",
} as const;

const ACTIONS = {
  "first-run": "empty.firstRun.action",
  filtered: "empty.filtered.action",
  cleared: "empty.cleared.action",
} as const;

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { variant, onAction, secondary, compact = false },
  ref,
) {
  const t = useT();
  const { reducedMotion } = useController();
  return (
    <div
      ref={ref}
      className={[styles.wrap, compact ? styles.compact : ""].join(" ")}
      data-testid={`empty-state-${variant}`}
      data-variant={variant}
      tabIndex={-1}
      role="status"
    >
      <OrbitMark size={compact ? "md" : "lg"} state="paused" label="" pulse={false} className={styles.orbit} aria-hidden="true" />
      <h2 className={styles.title}>{t(TITLES[variant])}</h2>
      <p className={styles.body}>{t(BODIES[variant])}</p>
      <div className={styles.actions} data-reduced-motion={reducedMotion ? "true" : "false"}>
        <button type="button" className={common.button} onClick={onAction} data-testid="empty-action">
          {t(ACTIONS[variant])}
        </button>
        {secondary}
      </div>
    </div>
  );
});
