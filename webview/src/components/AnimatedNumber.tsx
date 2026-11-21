/**
 * Isolated counter. Animates from the previous value to the target with ease-out-cubic over
 * ~700 ms, starts when first visible (IntersectionObserver), and jumps straight to the target
 * under reduced motion. Lives in its own component so stat updates never re-render the feed.
 */
import { memo, useEffect, useRef, useState } from "react";
import { formatNumber } from "../i18n";
import type { ResolvedLocale } from "../../../src/shared/model";

export const COUNTER_DURATION_MS = 700;

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

export function useInView<T extends Element>(once = true): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [once]);
  return [ref, inView];
}

export interface AnimatedNumberProps {
  value: number;
  locale: ResolvedLocale;
  reducedMotion: boolean;
  /** Preformatted text (e.g. duration) bypasses number formatting. */
  format?: (value: number) => string;
  className?: string;
  durationMs?: number;
  "data-testid"?: string;
}

export const AnimatedNumber = memo(function AnimatedNumber({
  value,
  locale,
  reducedMotion,
  format,
  className,
  durationMs = COUNTER_DURATION_MS,
  "data-testid": testId,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number | null>(null);
  const [viewRef, inView] = useInView<HTMLSpanElement>();
  displayRef.current = display;

  useEffect(() => {
    if (!inView || reducedMotion || typeof requestAnimationFrame === "undefined") {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    const step = (time: number) => {
      const t = (time - start) / durationMs;
      const next = Math.round(from + (value - from) * easeOutCubic(t));
      if (t >= 1) {
        fromRef.current = value;
        setDisplay(value);
        frameRef.current = null;
        return;
      }
      setDisplay(next);
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      fromRef.current = displayRef.current;
    };
  }, [value, reducedMotion, durationMs, inView]);

  const text = format ? format(display) : formatNumber(display, locale);
  return (
    <span ref={viewRef} className={className} data-testid={testId} data-value={value}>
      {text}
    </span>
  );
});
