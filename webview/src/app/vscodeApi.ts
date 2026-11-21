/**
 * Single access point to the VS Code webview API.
 *
 * `acquireVsCodeApi()` may only be called once per webview load, so it is acquired here at
 * module scope and guarded for the standalone browser preview (Vite dev server), where no
 * API exists. Outside VS Code a tiny in-memory shim stands in for state persistence.
 */

export interface HostApi {
  postMessage(message: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T>(state: T): T;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => HostApi;
    __ACTIVITYREEL__?: { surface?: string; locale?: string };
    __lpMockStarted?: boolean;
  }
}

const memoryState: { value: unknown } = { value: undefined };

const shim: HostApi = {
  postMessage: () => {
    /* replaced by the preview mock; preview listeners use window.postMessage */
  },
  getState: <T,>() => memoryState.value as T | undefined,
  setState: <T,>(state: T): T => {
    memoryState.value = state;
    return state;
  },
};

function acquire(): { api: HostApi; isPreview: boolean } {
  if (typeof window !== "undefined" && typeof window.acquireVsCodeApi === "function") {
    try {
      return { api: window.acquireVsCodeApi(), isPreview: false };
    } catch {
      // Already acquired (e.g. two bundles on one page) — fall through to preview shim.
    }
  }
  return { api: shim, isPreview: true };
}

export const hostBridge = acquire();
export const isPreview = hostBridge.isPreview;
