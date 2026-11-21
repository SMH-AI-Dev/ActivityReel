/**
 * Floating pill shown only while the user has scrolled away from the newest event.
 * Clicking jumps to the top instantly (no smooth scrolling) and clears the counter.
 */
import { forwardRef } from "react";
import { useController, useT } from "../app/ActivityReelContext";
import { formatNumber } from "../i18n";
import { ArrowDownIcon } from "./Icons";
import styles from "./NewActivityPill.module.css";

export interface NewActivityPillProps {
  count: number;
  onClick: () => void;
}

export const NewActivityPill = forwardRef<HTMLButtonElement, NewActivityPillProps>(function NewActivityPill(
  { count, onClick },
  ref,
) {
  const t = useT();
  const { state } = useController();
  if (count <= 0) return null;
  const label = count === 1 ? t("feed.newActivityOne") : t("feed.newActivity", { count: formatNumber(count, state.locale) });
  return (
    <button
      ref={ref}
      type="button"
      className={styles.pill}
      data-testid="new-activity-pill"
      aria-label={`${label} — ${t("feed.jumpToLatest")}`}
      onClick={onClick}
    >
      <span className={styles.count} dir="ltr" aria-hidden="true">
        {formatNumber(count, state.locale)}
      </span>
      <span className={styles.label}>{label}</span>
      <ArrowDownIcon size={12} className={styles.arrow} />
    </button>
  );
});
