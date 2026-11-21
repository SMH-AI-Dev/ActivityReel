/** Small shared helpers for the three surfaces (no JSX so both .ts and .tsx can use them). */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ActivityEvent } from "../../../src/shared/model";
import { selectVisibleEvents } from "../app/selectors";
import { useController } from "../app/CodeTrailContext";

/** Filtered events, recomputed when events/filters change; `now` refreshed once a second. */
export function useFilteredEvents(): { events: ActivityEvent[]; now: number } {
  const { state, now } = useController();
  const filtered = useMemo(() => selectVisibleEvents(state, now), [state, now]);
  return { events: filtered, now };
}

/** Latest event timestamp for liveness (0 when empty). */
export function useLastEventTs(): number {
  const { state } = useController();
  return state.events.length > 0 ? state.events[0].ts : 0;
}

/** rAF-throttled callback. */
export function useRafThrottled<T extends (...args: never[]) => void>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  const frame = useRef<number | null>(null);
  const throttled = useCallback((...args: never[]) => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      ref.current(...args);
    });
  }, []);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return throttled as T;
}

/** Push the current filter state to the host (workspace-scoped persistence) without loops. */
export function useFilterSync(): void {
  const { state, post } = useController();
  const { filters } = state;
  const last = useRef(filters);
  useEffect(() => {
    if (last.current === filters) return;
    last.current = filters;
    post({ type: "setFilters", filters });
  }, [filters, post]);
}

/** Filter panel open state lives in the store (persisted with vscode.setState). */
export function useFilterPanel(): [boolean, (open: boolean) => void] {
  const { state, dispatch } = useController();
  const setOpen = useCallback(
    (open: boolean) => dispatch({ type: "setFilterPanelOpen", open }),
    [dispatch],
  );
  return [state.filterPanelOpen, setOpen];
}
