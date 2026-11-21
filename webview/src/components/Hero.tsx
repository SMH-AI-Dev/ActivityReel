/**
 * Hero block. One per surface; the only place with gradient tint + orbit. The orbit stops under
 * reduced motion and high contrast. Degraded state ("Catching up…") dims the mark to 40 %.
 */
import { useT } from "../app/ActivityReelContext";
import { OrbitMark } from "./OrbitMark";
import type { OrbitSize } from "./OrbitMark";
import styles from "./Hero.module.css";

export interface HeroProps {
  title?: string;
  tagline?: string;
  /** Version chip text (e.g. "v0.1.0"). */
  version?: string;
  paused?: boolean;
  degraded?: boolean;
  size?: "md" | "lg" | "xl";
  /** Slot rendered under the title row (badges, actions). */
  children?: React.ReactNode;
  compact?: boolean;
  pulse?: boolean;
  testId?: string;
}

const ORBIT_SIZE: Record<NonNullable<HeroProps["size"]>, OrbitSize> = { md: "md", lg: "lg", xl: "xl" };

export function Hero({
  title,
  tagline,
  version,
  paused = false,
  degraded = false,
  size = "lg",
  children,
  compact = false,
  pulse = false,
  testId = "hero",
}: HeroProps) {
  const t = useT();
  const taglineId = "lp-hero-tagline";
  const classes = [styles.hero, styles[size], compact ? styles.compact : "", degraded ? styles.degraded : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={classes} data-testid={testId} aria-describedby={taglineId}>
      <div className={styles.orbitWrap} aria-hidden="true">
        <OrbitMark
          size={ORBIT_SIZE[size]}
          state={paused ? "paused" : degraded ? "stale" : "live"}
          label={paused ? t("hero.orbitPausedLabel") : t("hero.orbitLabel")}
          pulse={pulse}
          className={styles.orbit}
        />
      </div>
      <div className={styles.text}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title ?? t("hero.product")}</h1>
          {version ? (
            <span className={styles.version} data-testid="hero-version" dir="ltr">
              v{version}
            </span>
          ) : null}
        </div>
        <p id={taglineId} className={styles.tagline}>
          {tagline ?? t("hero.tagline")}
        </p>
        {degraded ? <span className={styles.degradedText}>{t("badge.catchingUp")}</span> : null}
        {children ? <div className={styles.slot}>{children}</div> : null}
      </div>
    </section>
  );
}
