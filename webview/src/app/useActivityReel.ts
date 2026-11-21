import { useEffect, useMemo, useReducer, useRef } from "react";
import type { Surface } from "../../../src/shared/model";
import { createTranslator } from "../i18n";
import type { Controller } from "./ActivityReelContext";
import { postToHost } from "./adapters";
import { currentSurfaceHint, ensureMockHost, subscribeToHost } from "./client";
import { useNow, useReducedMotion } from "./hooks";
import { initialState, reducer } from "./store";
import type { AppState } from "./store";
import { parsePersistedState } from "./validate";
import { hostBridge, isPreview } from "./vscodeApi";

/** setTimeout bound for a diff request before it is marked failed. */
export const DIFF_TIMEOUT_MS = 15_000;

function surfaceFromHint(state: AppState): Surface {
  return state.initialized ? state.surface : currentSurfaceHint();
}

export function useActivityReel(): Controller & { hydrated: boolean; preview: boolean } {
  const initial = useMemo<AppState>(() => {
    let persisted: unknown;
    try {
      persisted = hostBridge.api.getState();
    } catch {
      persisted = undefined;
    }
    const saved = parsePersistedState(persisted);
    return {
      ...initialState,
      expanded: saved.expanded,
      scrollAnchor: saved.anchor,
      filterPanelOpen: saved.filterPanelOpen,
    };
  }, []);

  const [state, dispatch] = useReducer(reducer, initial);
  const now = useNow(1000);
  const reducedMotion = useReducedMotion();

  // --- protocol ------------------------------------------------------------
  // In the preview the mock host loads lazily, so `ready` waits for its listener; in VS Code
  // ensureMockHost resolves immediately and the host answers `ready` as usual.
  const readySent = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeToHost((message) => dispatch({ type: "host", message }));
    void ensureMockHost().then(() => {
      if (cancelled || readySent.current) return;
      readySent.current = true;
      postToHost({ type: "ready" });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const t = useMemo(() => createTranslator(state.locale), [state.locale]);
  const surface = surfaceFromHint(state);

  // --- document attributes (dir/lang/surface) -------------------------------
  useEffect(() => {
    const html = document.documentElement;
    const dir = state.initialized ? state.direction : state.locale === "fa" ? "rtl" : "ltr";
    html.setAttribute("dir", dir);
    html.setAttribute("lang", state.locale);
    document.body.dataset.surface = surface;
  }, [state.direction, state.locale, state.initialized, surface]);

  useEffect(() => {
    document.body.classList.toggle("reduced-motion", reducedMotion);
  }, [reducedMotion]);

  // --- diff requests (lazy, cached, never duplicated) -----------------------
  const diffTimer = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const needs = state.expanded.filter(
      (id) =>
        !state.diffs[id] &&
        !state.pendingDiffIds.includes(id) &&
        !state.failedDiffIds.includes(id) &&
        !state.expiredDiffIds.includes(id),
    );
    if (needs.length > 0) {
      for (const id of needs) {
        dispatch({ type: "setDiffPending", id, pending: true });
        postToHost({ type: "requestDiff", id });
        const timer = setTimeout(() => dispatch({ type: "diffFailed", id }), DIFF_TIMEOUT_MS);
        diffTimer.current.set(id, timer);
      }
    }
  }, [state.expanded, state.diffs, state.pendingDiffIds, state.failedDiffIds, state.expiredDiffIds]);

  // Drop watchdogs once the payload arrived or the request already resolved.
  useEffect(() => {
    for (const [id, timer] of diffTimer.current) {
      if (state.diffs[id] || (!state.pendingDiffIds.includes(id) && !state.expanded.includes(id))) {
        clearTimeout(timer);
        diffTimer.current.delete(id);
      }
    }
  }, [state.diffs, state.pendingDiffIds, state.expanded]);

  useEffect(() => {
    const timers = diffTimer.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // --- persisted UI state (never document text) -----------------------------
  useEffect(() => {
    try {
      hostBridge.api.setState({
        expanded: state.expanded.slice(-200),
        anchor: state.scrollAnchor,
        filterPanelOpen: state.filterPanelOpen,
      });
    } catch {
      // Persistence is best effort.
    }
  }, [state.expanded, state.scrollAnchor, state.filterPanelOpen]);

  // --- older pages ----------------------------------------------------------
  useEffect(() => {
    if (!state.olderPending) return;
    const timer = setTimeout(() => dispatch({ type: "olderTimeout" }), 10_000);
    return () => clearTimeout(timer);
  }, [state.olderPending]);

  return {
    state,
    dispatch,
    t,
    surface,
    post: postToHost,
    now,
    reducedMotion,
    hydrated: state.initialized,
    preview: isPreview,
  };
}
