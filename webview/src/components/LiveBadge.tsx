/**
 * Liveness pill. Renders a `<button>` (panel: toggles pause) or a `<span>` (sidebar: status only).
 * Stale when no event arrived for > 60 s; paused replaces the pulsing dot with a static ring.
 */
import { forwardRef } from "react";
import type { Ref } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { useT } from "../app/ActivityReelContext";
import styles from "./LiveBadge.module.css";

export type Liveness = "live" | "paused" | "stale";

export function livenessOf(paused: boolean, lastEventTs: number, now: number): Liveness {
  if (paused) return "paused";
  if (lastEventTs > 0 && now - lastEventTs > 60_000) return "stale";
  return "live";
}

export type LiveBadgeProps = {
  liveness: Liveness;
  /** When provided the badge becomes a toggle button. */
  onToggle?: () => void;
  /** When provided the badge renders a native button (required for interactive use). */
  asButton?: boolean;
  className?: string;
  id?: string;
  "data-testid"?: string;
} & (
  | { asButton: true; onToggle: () => void; ["aria-controls"]?: string }
  | { asButton?: false; onToggle?: () => void }
);

const labelKeys = { live: "badge.live", paused: "badge.paused", stale: "badge.stale" } as const;

export const LiveBadge = forwardRef<HTMLButtonElement | HTMLSpanElement, LiveBadgeProps>(function LiveBadge(
  { liveness, onToggle, asButton = false, className, id, "data-testid": testId = "live-badge", ...rest },
  ref,
) {
  const t = useT();
  const label = t(labelKeys[liveness]);
  const classes = [styles.badge, styles[liveness], className ?? ""].filter(Boolean).join(" ");
  const content = (
    <>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.text}>{label}</span>
    </>
  );
  if (asButton) {
    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        id={id}
        type="button"
        className={classes}
        data-testid={testId}
        data-liveness={liveness}
        aria-pressed={liveness === "paused"}
        aria-label={liveness === "paused" ? t("badge.resumeAction") : t("badge.pauseAction")}
        onClick={onToggle}
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {content}
      </button>
    );
  }
  return (
    <span
      ref={ref as Ref<HTMLSpanElement>}
      id={id}
      className={classes}
      data-testid={testId}
      data-liveness={liveness}
      {...(rest as HTMLAttributes<HTMLSpanElement>)}
    >
      {content}
    </span>
  );
});
