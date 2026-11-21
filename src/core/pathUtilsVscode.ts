import * as vscode from "vscode";
import {
  compareKeyLike,
  displayPathLike,
  isInsideWorkspaceLike,
  isTrackableSchemeLike,
  uriKeyLike,
} from "./pathUtils";

/**
 * vscode-typed wrappers around the pure helpers in `pathUtils.ts`. Kept in a separate module so
 * the pure helpers stay unit-testable without a `vscode` module.
 */

/** Stable key for tracking maps: the full URI string. */
export function uriKey(uri: vscode.Uri): string {
  return uriKeyLike(uri);
}

/** Key used for case-insensitive comparisons on Windows; never used for display. */
export function compareKey(uri: vscode.Uri): string {
  return compareKeyLike(uri);
}

/**
 * Lexical workspace membership test (scheme/authority first, then separator-bounded fsPath
 * prefix). Symlinks are intentionally not resolved.
 */
export function isInsideWorkspace(
  uri: vscode.Uri,
  folders: readonly vscode.WorkspaceFolder[],
): boolean {
  return isInsideWorkspaceLike(uri, folders);
}

/** Only `file` and `untitled` documents are trackable. */
export function isTrackableScheme(uri: vscode.Uri): boolean {
  return isTrackableSchemeLike(uri);
}

/**
 * Display label for a URI: `workspace.asRelativePath` (folder-prefixed in multi-root) inside the
 * workspace, readable untitled label, basename outside. Never absolute.
 */
export function displayPath(
  uri: vscode.Uri,
  folders: readonly vscode.WorkspaceFolder[],
): string {
  const multiRoot = folders.length > 1;
  if (uri.scheme === "untitled") return displayPathLike(uri, folders, multiRoot);
  if (isInsideWorkspace(uri, folders)) {
    let relative = "";
    try {
      relative = vscode.workspace.asRelativePath(uri, multiRoot);
    } catch {
      relative = "";
    }
    const normalized = relative.replace(/\\/g, "/").replace(/^\/+/, "");
    if (normalized.length > 0 && !looksAbsolute(normalized)) return normalized;
  }
  return displayPathLike(uri, folders, multiRoot);
}

function looksAbsolute(value: string): boolean {
  return /^[a-zA-Z]:\//.test(value) || value.startsWith("/");
}
