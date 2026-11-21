import { useEffect, useRef, useState } from "react";
import type { ResolvedLocale } from "../../../src/shared/model";
import { useController } from "./CodeTrailContext";

/**
 * Reduced-motion hook: honours both `prefers-reduced-motion` and VS Code's
 * `body.vscode-reduce-motion` class, which can appear after load.
 */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const read = () =>
    typeof window !== "undefined" &&
    (window.matchMedia?.(query).matches === true ||
      (typeof document !== "undefined" && document.body.classList.contains("vscode-reduce-motion")));

  const [reduced, setReduced] = useState(read);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia?.(query);
    const update = () => setReduced(read());
    media?.addEventListener?.("change", update);
    const observer =
      typeof MutationObserver !== "undefined" && typeof document !== "undefined"
        ? new MutationObserver(update)
        : null;
    observer?.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    update();
    return () => {
      media?.removeEventListener?.("change", update);
      observer?.disconnect();
    };
  }, []);

  return reduced;
}

/** Ticking clock aligned to the given interval; skipped entirely when `active` is false. */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => setNow(Date.now()), intervalMs);
    };
    start();
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [intervalMs, active]);
  return now;
}

/** Debounced mirror of `value`; instant when `immediate`. */
export function useDebounced<T>(value: T, delayMs: number, immediate = false): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (immediate) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, immediate]);
  return immediate ? value : debounced;
}

export interface AnnouncementState {
  text: string;
  flush: () => void;
}

/**
 * Coalesced polite announcements: at most one per `windowMs`, summarising the newest events.
 * Returns a `flush()` to publish immediately (used for pause / filter changes).
 */
export function useCoalescedAnnouncer(windowMs = 5000): AnnouncementState & { push: (text: string) => void } {
  const [text, setText] = useState("");
  const lastAt = useRef(0);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publish = (next: string) => {
    lastAt.current = Date.now();
    setText(next);
  };

  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current !== null) {
      const next = pending.current;
      pending.current = null;
      publish(next);
    }
  };

  const push = (next: string) => {
    const elapsed = Date.now() - lastAt.current;
    if (elapsed >= windowMs) {
      publish(next);
      return;
    }
    pending.current = next;
    if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        flush();
      }, windowMs - elapsed);
    }
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { text, flush, push };
}

export function useLocale(): ResolvedLocale {
  return useController().state.locale;
}
