/**
 * Paused banner (in-flow, 40 px) under the hero with a Resume button.
 * The sidebar variant is a 28 px pill reported by LiveBadge; this component is the banner.
 */
import { useT } from "../app/ActivityReelContext";
import { PlayIcon } from "./Icons";
import common from "../styles/common.module.css";
import styles from "./PausedState.module.css";

export interface PausedStateProps {
  onResume: () => void;
  compact?: boolean;
}

export function PausedState({ onResume, compact = false }: PausedStateProps) {
  const t = useT();
  return (
    <div
      className={[styles.banner, compact ? styles.compact : ""].join(" ")}
      data-testid="paused-state"
      role="status"
    >
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.text}>
        <strong className={styles.title}>{t("paused.title")}</strong>
        <span className={styles.body}>{compact ? null : t("paused.body")}</span>
      </span>
      <button type="button" className={[common.buttonSecondary, styles.resume].join(" ")} onClick={onResume}>
        <PlayIcon size={12} />
        {t("paused.resume")}
      </button>
    </div>
  );
}
