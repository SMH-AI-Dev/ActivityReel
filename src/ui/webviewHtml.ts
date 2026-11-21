import * as vscode from "vscode";
import type { ResolvedLocale, Surface } from "../shared/model";

function nonce(): string {
  const bytes = new Uint8Array(16);
  // Node 20+ and Electron expose Web Crypto globally.
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * The single HTML shell for the sidebar, panel and about surfaces. Scripts are nonce-bound,
 * every other origin is denied, and the bundle + stylesheet are local extension resources.
 */
export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  surface: Surface,
  locale: ResolvedLocale,
): string {
  const scriptNonce = nonce();
  const mediaRoot = vscode.Uri.joinPath(extensionUri, "media", "webview");
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "main.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "main.css"));
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${scriptNonce}' ${webview.cspSource}`,
    "connect-src 'none'",
    "object-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const bootstrap = JSON.stringify({ surface, locale }).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${locale === "fa" ? "rtl" : "ltr"}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CodeTrail</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body data-surface="${surface}">
  <div id="root"></div>
  <script nonce="${scriptNonce}">window.__CODETRAIL__ = ${bootstrap};</script>
  <script nonce="${scriptNonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}
