/**
 * Protocol client: subscribes to `message` events from the extension host (or the preview mock),
 * validates them, and forwards the typed result. Non-React so it can run at module scope.
 */
import type { Surface } from "../../../src/shared/model";
import type { HostMessage } from "../../../src/shared/protocol";
import { MOCK_MESSAGE_TYPE } from "./adapters";
import { parseHostMessage } from "./validate";
import { isPreview } from "./vscodeApi";

export type MessageListener = (message: HostMessage) => void;

export interface MockMessageEnvelope {
  type: typeof MOCK_MESSAGE_TYPE;
  message: unknown;
}

/** Surface of a lazily loaded mock host (preview only). */
export interface MockHostControl {
  stop(): void;
}

let mockHostPromise: Promise<MockHostControl> | null = null;

/**
 * Surface hint handed to the host with `ready`. The bundled entry point shares one module
 * instance across surfaces, so this must not be read once at import time.
 */
export function currentSurfaceHint(): Surface {
  if (typeof window === "undefined") return "panel";
  const hint = window.__ACTIVITYREEL__?.surface;
  return hint === "sidebar" || hint === "about" ? hint : "panel";
}

export function subscribeToHost(listener: MessageListener): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: MessageEvent) => {
    // VS Code delivers host messages from the parent frame, so the source is not `window`.
    // Shape validation is the trust boundary; nothing else runs inside the webview.
    let data: unknown = event.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (
      typeof data === "object" &&
      data !== null &&
      (data as { type?: unknown }).type === MOCK_MESSAGE_TYPE
    ) {
      data = (data as MockMessageEnvelope).message;
    }
    const parsed = parseHostMessage(data);
    if (parsed) listener(parsed);
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

/**
 * In the standalone preview there is no extension host, so a realistic mock is started on
 * demand (it answers `ready` with an `init`, then streams sample activity).
 */
export function ensureMockHost(): Promise<void> {
  if (!isPreview || typeof window === "undefined" || window.__lpMockStarted) return Promise.resolve();
  window.__lpMockStarted = true;
  if (!mockHostPromise) {
    mockHostPromise = import("./mockHost")
      .then((mod) => mod.startMockHost())
      .catch((error: unknown) => {
        // A broken preview must never break the UI.
        console.warn("ActivityReel preview mock failed", error);
        return { stop: () => undefined };
      });
  }
  return mockHostPromise.then(() => undefined);
}
