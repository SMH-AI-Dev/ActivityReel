/**
 * App root: owns the store via `useActivityReel`, publishes state/dispatch through context, renders
 * exactly one surface and the single toast host. Surfaces never fetch directly.
 */
import { useMemo } from "react";
import { ActivityReelProvider } from "./app/ActivityReelContext";
import { useActivityReel } from "./app/useActivityReel";
import { Toast } from "./components/Toast";
import { About } from "./surfaces/About";
import { Panel } from "./surfaces/Panel";
import { Sidebar } from "./surfaces/Sidebar";
import styles from "./App.module.css";

export function App({ initialSurface }: { initialSurface?: "panel" | "sidebar" | "about" }) {
  const controller = useActivityReel();
  const { state } = controller;
  const surface = state.initialized ? state.surface : (initialSurface ?? controller.surface);
  const context = useMemo(
    () => ({
      state: controller.state,
      dispatch: controller.dispatch,
      t: controller.t,
      surface,
      post: controller.post,
      now: controller.now,
      reducedMotion: controller.reducedMotion,
    }),
    [controller.state, controller.dispatch, controller.t, surface, controller.post, controller.now, controller.reducedMotion],
  );

  return (
    <ActivityReelProvider controller={context}>
      <div className={styles.app} data-testid="app" data-surface={surface}>
        {surface === "sidebar" ? <Sidebar /> : surface === "about" ? <About /> : <Panel />}
        {state.toast ? <Toast key={state.toast.id} toast={state.toast} /> : null}
      </div>
    </ActivityReelProvider>
  );
}
