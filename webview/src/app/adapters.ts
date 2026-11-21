/**
 * Adapter between the webview and its peer:
 *  - VS Code extension host: `postMessage` through the API acquired once at module load.
 *  - Browser preview (no API): `window.postMessage` consumed by the preview mock host.
 */
import type { WebviewMessage } from "../../../src/shared/protocol";
import { hostBridge, isPreview } from "./vscodeApi";

/** Message type prefix used between the preview shell and the preview mock host. */
export const MOCK_MESSAGE_TYPE = "activityreel:mock";

export type Adapter = (message: WebviewMessage) => void;

const realAdapter: Adapter = (message) => {
  try {
    hostBridge.api.postMessage(message);
  } catch {
    // The webview may be disposed; posting must never throw into React.
  }
};

const previewAdapter: Adapter = (message) => {
  if (typeof window === "undefined") return;
  window.postMessage({ type: MOCK_MESSAGE_TYPE, message }, "*");
};

let active: Adapter = isPreview ? previewAdapter : realAdapter;

export function postToHost(message: WebviewMessage): void {
  active(message);
}

export function setAdapterForTests(adapter: Adapter | null): void {
  active = adapter ?? (isPreview ? previewAdapter : realAdapter);
}
