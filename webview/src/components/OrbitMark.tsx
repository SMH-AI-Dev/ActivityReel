/**
 * CSS-only orbit mark: one ring, three beads (charts blue/green/purple with fallbacks) and a
 * centre dot. No images, no raster, no network. Rotation is driven by the `--lp-orbit-duration`
 * token, which collapses to `0s` under reduced motion and high contrast.
 */
import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import styles from "./OrbitMark.module.css";

export type OrbitSize = "sm" | "md" | "lg" | "xl";
export type OrbitState = "live" | "paused" | "stale";

export interface OrbitMarkProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  size?: OrbitSize;
  state?: OrbitState;
  /** Accessible name; the mark is `role="img"`. */
  label: string;
  /** Pulse the beads once or twice after a new event lands. */
  pulse?: boolean;
}

const BEADS: ReadonlyArray<{ cx: number; cy: number; r: number; token: string; delay: number }> = [
  { cx: 64, cy: 16, r: 6, token: "blue", delay: 0 },
  { cx: 28, cy: 87, r: 4.5, token: "green", delay: 0.18 },
  { cx: 102, cy: 84, r: 3.5, token: "purple", delay: 0.36 },
];

export const OrbitMark = forwardRef<HTMLSpanElement, OrbitMarkProps>(function OrbitMark(
  { size = "md", state = "live", label, pulse = false, className, ...rest },
  ref,
) {
  const classes = [styles.mark, styles[size], styles[state], pulse ? styles.pulse : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      ref={ref}
      className={classes}
      role="img"
      aria-label={label}
      data-testid="orbit-mark"
      data-size={size}
      data-state={state}
      {...rest}
    >
      <svg viewBox="0 0 128 128" width="100%" height="100%" aria-hidden="true" focusable="false">
        <g className={styles.orbit}>
          <circle className={styles.ring} cx="64" cy="64" r="48" />
          {BEADS.map((bead) => (
            <circle
              key={bead.token}
              className={styles.bead}
              data-bead={bead.token}
              cx={bead.cx}
              cy={bead.cy}
              r={bead.r}
              style={{ ["--bead-delay" as string]: `${bead.delay}s` }}
            />
          ))}
        </g>
        <circle className={styles.centre} cx="64" cy="64" r="7" />
      </svg>
    </span>
  );
});
