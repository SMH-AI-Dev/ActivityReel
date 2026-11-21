/**
 * Pure helpers only: no `vscode` import so they are unit-testable in Node. The vscode-typed
 * wrappers (`uriKey`, `compareKey`, `isInsideWorkspace`, `displayPath`, `isTrackableScheme`)
 * live in `pathUtilsVscode.ts`.
 */

import { minimatch } from "minimatch";

/** Minimal URI shape needed by the pure helpers (keeps them testable without vscode). */
export interface UriLike {
  scheme: string;
  authority: string;
  path: string;
  fsPath: string;
  toString(): string;
}

export interface FolderLike {
  uri: UriLike;
}

const WIN32 = process.platform === "win32";
const UNTITLED_LABEL = /^Untitled-\d+$/;

/** Stable key for tracking maps: the full URI string. */
export function uriKeyLike(uri: UriLike): string {
  return uri.toString();
}

/** Key used for case-insensitive comparisons on Windows; never used for display. */
export function compareKeyLike(uri: UriLike): string {
  const value = uri.toString();
  if (!WIN32) return value;
  const fsPath = uri.fsPath;
  if (fsPath.length === 0) return value;
  const idx = value.indexOf(fsPath);
  if (idx < 0) return value;
  return value.slice(0, idx) + fsPath.toLowerCase() + value.slice(idx + fsPath.length);
}

/** Normalize a filesystem path to forward slashes and strip trailing separators. */
export function normalizePath(input: string): string {
  const slashed = input.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return slashed.replace(/\/+$/, "");
}

function caseFold(input: string): string {
  return WIN32 ? input.toLowerCase() : input;
}

/** True when `child` is `parent` or lies beneath it (lexical, separator-bounded). */
export function isPathInside(childFsPath: string, parentFsPath: string): boolean {
  const child = caseFold(normalizePath(childFsPath));
  const parent = caseFold(normalizePath(parentFsPath));
  if (child.length === 0) return false;
  if (parent.length === 0) return true;
  if (child === parent) return true;
  return child.startsWith(`${parent}/`);
}

/**
 * Lexical workspace membership test. Scheme and authority must match a folder first, then the
 * normalized fsPath must sit inside the folder. Symlinks are intentionally not resolved.
 */
export function isInsideWorkspaceLike(uri: UriLike, folders: readonly FolderLike[]): boolean {
  for (const folder of folders) {
    const root = folder.uri;
    if (uri.scheme !== root.scheme) continue;
    if ((uri.authority ?? "") !== (root.authority ?? "")) continue;
    if (isPathInside(uri.fsPath, root.fsPath)) return true;
  }
  return false;
}

/** Filesystem basename of a URI or a path (handles both separators). */
export function basename(uriOrPath: UriLike | string): string {
  if (typeof uriOrPath === "string") return basenameOf(uriOrPath);
  if (typeof uriOrPath.path === "string" && uriOrPath.path.length > 0) {
    return basenameOf(uriOrPath.path);
  }
  return basenameOf(uriOrPath.fsPath ?? "");
}

export function basenameOf(input: string): string {
  const normalized = normalizePath(input);
  const idx = normalized.lastIndexOf("/");
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

let encoder: TextEncoder | undefined;

/** UTF-8 byte length without importing Node APIs (works in host and tests). */
export function byteLength(text: string): number {
  if (encoder === undefined) encoder = new TextEncoder();
  return encoder.encode(text).length;
}

/** Readable, never-absolute label for a document without a workspace path. */
export function untitledLabel(uri: UriLike): string {
  const p = basenameOf(uri.path);
  if (UNTITLED_LABEL.test(p)) return p;
  return p.length > 0 ? `Untitled-${p}` : "Untitled";
}

/** Only `file` and `untitled` documents are trackable. */
export function isTrackableSchemeLike(uri: UriLike): boolean {
  return uri.scheme === "file" || uri.scheme === "untitled";
}

/**
 * Display label for a URI. Inside a workspace folder: path relative to that folder, prefixed by
 * the folder name in multi-root workspaces. Untitled: its readable label. Anything outside:
 * the basename only. Never absolute.
 */
export function displayPathLike(uri: UriLike, folders: readonly FolderLike[], multiRoot: boolean): string {
  if (uri.scheme === "untitled") return untitledLabel(uri);
  for (const folder of folders) {
    const root = folder.uri;
    if (uri.scheme !== root.scheme) continue;
    if ((uri.authority ?? "") !== (root.authority ?? "")) continue;
    if (!isPathInside(uri.fsPath, root.fsPath)) continue;
    const relative = relativePath(uri.fsPath, root.fsPath);
    if (relative.length === 0) {
      const base = basenameOf(root.fsPath);
      return base.length > 0 ? base : "workspace";
    }
    if (!multiRoot) return relative;
    const folderName = basenameOf(root.fsPath);
    return folderName.length > 0 ? `${folderName}/${relative}` : relative;
  }
  const base = basenameOf(uri.fsPath) || basenameOf(uri.path);
  return base.length > 0 ? base : "file";
}

/** Forward-slashed path of `childFsPath` relative to `parentFsPath`; "" when not inside. */
export function relativePath(childFsPath: string, parentFsPath: string): string {
  const child = normalizePath(childFsPath);
  const parent = normalizePath(parentFsPath);
  if (!isPathInside(child, parent)) return "";
  if (child.length === parent.length) return "";
  return child.slice(parent.length + 1);
}

const matcherCache = new Map<string, (value: string) => boolean>();
const MATCHER_CACHE_LIMIT = 512;

function matcherFor(pattern: string): (value: string) => boolean {
  const cached = matcherCache.get(pattern);
  if (cached !== undefined) return cached;
  let test: (value: string) => boolean;
  try {
    test = (value: string) => minimatch(value, pattern, { dot: true, matchBase: false });
  } catch {
    test = () => false;
  }
  if (matcherCache.size >= MATCHER_CACHE_LIMIT) matcherCache.clear();
  matcherCache.set(pattern, test);
  return test;
}

/**
 * Glob exclusion over forward-slashed workspace-relative paths. Backslashes in either the path
 * or the pattern are normalized. Empty glob lists never exclude.
 */
export function isExcluded(relPath: string, globs: readonly string[]): boolean {
  if (globs.length === 0) return false;
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (normalized.length === 0) return false;
  for (const pattern of globs) {
    if (typeof pattern !== "string") continue;
    const trimmed = pattern.trim().replace(/\\/g, "/");
    if (trimmed.length === 0) continue;
    // Negation is unsupported: minimatch would invert the pattern and exclude everything else.
    if (trimmed.startsWith("!")) continue;
    if (matcherFor(trimmed)(normalized)) return true;
  }
  return false;
}
