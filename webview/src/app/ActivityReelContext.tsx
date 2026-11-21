import { createContext, useContext } from "react";
import type { Dispatch, ReactNode } from "react";
import type { Surface } from "../../../src/shared/model";
import type { Translator } from "../i18n";
import { postToHost } from "./adapters";
import type { Action, AppState } from "./store";

export interface Controller {
  state: AppState;
  dispatch: Dispatch<Action>;
  t: Translator;
  /** Negotiated surface (init overrides the bootstrap hint). */
  surface: Surface;
  post: typeof postToHost;
  now: number;
  reducedMotion: boolean;
}

export const StateContext = createContext<AppState | null>(null);
export const DispatchContext = createContext<Dispatch<Action> | null>(null);
export const ControllerContext = createContext<Controller | null>(null);

export function useAppState(): AppState {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error("useAppState must be used inside <ActivityReelProvider>");
  return ctx;
}

export function useDispatch(): Dispatch<Action> {
  const ctx = useContext(DispatchContext);
  if (!ctx) throw new Error("useDispatch must be used inside <ActivityReelProvider>");
  return ctx;
}

export function useController(): Controller {
  const ctx = useContext(ControllerContext);
  if (!ctx) throw new Error("useController must be used inside <ActivityReelProvider>");
  return ctx;
}

/** Translator bound to the current locale. */
export function useT(): Translator {
  return useController().t;
}

export function ActivityReelProvider({
  controller,
  children,
}: {
  controller: Omit<Controller, "post"> & { post?: Controller["post"] };
  children: ReactNode;
}) {
  const value: Controller = { ...controller, post: controller.post ?? postToHost };
  return (
    <DispatchContext.Provider value={controller.dispatch}>
      <StateContext.Provider value={controller.state}>
        <ControllerContext.Provider value={value}>{children}</ControllerContext.Provider>
      </StateContext.Provider>
    </DispatchContext.Provider>
  );
}
