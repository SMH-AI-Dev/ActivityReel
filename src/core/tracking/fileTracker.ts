import * as vscode from "vscode";
import { LIMITS } from "../../shared/constants";
import type { EventDraft, Settings } from "../../shared/model";
import type { Logger } from "../logger";
import { isExcluded } from "../pathUtils";
import { isInsideWorkspace, isTrackableScheme, uriKey } from "../pathUtilsVscode";
import type { EventSink } from "../store/eventSink";

export interface FileTrackerOptions {
  sink: EventSink;
  logger: Logger;
  getSettings: () => Settings;
  /** True when a tracked document for this uri.toString() key is open in the editor. */
  isDocumentOpen: (key: string) => boolean;
  /** True when the open document for this key has unflushed edits. */
  isDocumentDirty: (key: string) => boolean;
  /** Workspace-relative (or basename) display label for a URI. */
  displayPath: (uri: vscode.Uri) => string;
  /** Whether the relative path matches exclude globs. */
  exclude: (relPath: string) => boolean;
  now?: () => number;
}

type FileKind = "file-create" | "file-delete" | "file-change";

interface PendingWatcherEvent {
  kind: FileKind;
  uri: vscode.Uri;
  handle?: ReturnType<typeof setTimeout>;
  at: number;
}

/**
 * File-system activity from the editor APIs (authoritative for gestures) and one recursive
 * watcher (external/on-disk operations). Never reads or stats file content.
 */
export class FileTracker {
  private readonly sink: EventSink;
  private readonly logger: Logger;
  private readonly getSettings: () => Settings;
  private readonly isDocumentOpen: (key: string) => boolean;
  private readonly isDocumentDirty: (key: string) => boolean;
  private readonly displayPath: (uri: vscode.Uri) => string;
  private readonly exclude: (relPath: string) => boolean;
  private readonly now: () => number;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly recent = new Map<string, number>();
  private readonly pending = new Map<string, PendingWatcherEvent>();
  private watcher: vscode.FileSystemWatcher | undefined;
  private watcherExcludeGlobs: string[] = [];
  private started = false;
  private disposed = false;

  constructor(options: FileTrackerOptions) {
    this.sink = options.sink;
    this.logger = options.logger;
    this.getSettings = options.getSettings;
    this.isDocumentOpen = options.isDocumentOpen;
    this.isDocumentDirty = options.isDocumentDirty;
    this.displayPath = options.displayPath;
    this.exclude = options.exclude;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const settings = this.getSettings();
    if (settings.trackFileOperations) {
      this.disposables.push(
        vscode.workspace.onDidCreateFiles((event) => {
          for (const uri of event.files) this.onApi("file-create", uri);
        }),
        vscode.workspace.onDidDeleteFiles((event) => {
          for (const uri of event.files) this.onApi("file-delete", uri);
        }),
        vscode.workspace.onDidRenameFiles((event) => {
          for (const file of event.files) this.onRename(file.oldUri, file.newUri);
        }),
      );
    }
    if (settings.trackExternalChanges) {
      this.readWatcherExclude();
      this.disposables.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration("files.watcherExclude")) this.readWatcherExclude();
        }),
      );
      this.createWatcher();
    }
  }

  private readWatcherExclude(): void {
    try {
      const config = vscode.workspace.getConfiguration("files");
      const raw = config.get<Record<string, boolean>>("watcherExclude", {});
      this.watcherExcludeGlobs =
        raw !== null && typeof raw === "object"
          ? Object.keys(raw).filter((glob) => raw[glob] === true)
          : [];
    } catch {
      this.watcherExcludeGlobs = [];
    }
  }

  private createWatcher(): void {
    try {
      this.watcher = vscode.workspace.createFileSystemWatcher("**/*");
    } catch (error) {
      this.logger.warn(`File watcher unavailable: ${safeMessage(error)}`);
      this.watcher = undefined;
      return;
    }
    const watcher = this.watcher;
    this.disposables.push(
      watcher,
      watcher.onDidCreate((uri) => this.onWatcher("file-create", uri)),
      watcher.onDidDelete((uri) => this.onWatcher("file-delete", uri)),
      watcher.onDidChange((uri) => this.onWatcher("file-change", uri)),
    );
  }

  // ---------------------------------------------------------------- filters

  private relPathFor(uri: vscode.Uri, fromWatcher = false): string | undefined {
    if (!isTrackableScheme(uri) || uri.scheme !== "file") return undefined;
    const folders = vscode.workspace.workspaceFolders ?? [];
    let relPath: string;
    try {
      if (!isInsideWorkspace(uri, folders)) return undefined;
      relPath = this.displayPath(uri);
    } catch {
      return undefined;
    }
    if (relPath.length === 0) return undefined;
    if (this.exclude(relPath)) return undefined;
    if (fromWatcher && isExcluded(relPath, this.watcherExcludeGlobs)) return undefined;
    return relPath;
  }

  // ---------------------------------------------------------------- dedupe

  private recentKey(kind: string, uri: vscode.Uri): string {
    // on Windows the URI string casing may differ between API and watcher; fold the fsPath.
    const key = uriKey(uri);
    return process.platform === "win32" ? `${kind}|${key.toLowerCase()}` : `${kind}|${key}`;
  }

  private wasEmittedRecently(kind: string, uri: vscode.Uri): boolean {
    const now = this.now();
    const key = this.recentKey(kind, uri);
    const at = this.recent.get(key);
    if (at !== undefined && now - at < LIMITS.fileDedupeMs) return true;
    return false;
  }

  private markEmitted(kind: string, uri: vscode.Uri): void {
    const now = this.now();
    for (const [key, at] of this.recent) {
      if (now - at >= LIMITS.fileDedupeMs) this.recent.delete(key);
    }
    this.recent.set(this.recentKey(kind, uri), now);
  }

  // ---------------------------------------------------------------- API events

  private onApi(kind: "file-create" | "file-delete", uri: vscode.Uri): void {
    if (this.disposed) return;
    if (!this.getSettings().trackFileOperations) return;
    const relPath = this.relPathFor(uri);
    if (relPath === undefined) return;
    if (this.wasEmittedRecently(kind, uri)) return;
    this.markEmitted(kind, uri);
    this.append({ kind, relPath, source: "editor" });
  }

  private onRename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    if (this.disposed) return;
    if (!this.getSettings().trackFileOperations) return;
    const relPath = this.relPathFor(newUri);
    if (relPath === undefined) return;
    const fromPath = this.relPathFor(oldUri) ?? safeDisplay(this.displayPath, oldUri);
    this.markEmitted("file-rename", newUri);
    this.markEmitted("file-delete", oldUri);
    this.markEmitted("file-create", newUri);
    this.append({ kind: "file-rename", relPath, fromPath });
  }

  // ---------------------------------------------------------------- watcher events

  private onWatcher(kind: FileKind, uri: vscode.Uri): void {
    if (this.disposed) return;
    if (!this.getSettings().trackExternalChanges) return;
    if (kind === "file-change") {
      const key = uriKey(uri);
      // A clean open document owns this path (the edit/save pipeline reports it truthfully); a
      // dirty document must not hide an external on-disk write.
      if (this.isDocumentOpen(key) && !this.isDocumentDirty(key)) return;
    }
    const key = `${kind}|${uriKey(uri)}`;
    const existing = this.pending.get(key);
    if (existing !== undefined && existing.handle !== undefined) {
      // Coalesce repeats of the same kind per path within the debounce window.
      clearTimeout(existing.handle);
    }
    const pending: PendingWatcherEvent = { kind, uri, at: this.now() };
    this.pending.set(key, pending);
    const delay = kind === "file-change" ? LIMITS.watcherDebounceMs : 0;
    pending.handle = setTimeout(() => {
      if (this.pending.get(key) !== pending) return;
      this.pending.delete(key);
      this.emitWatcher(pending);
    }, delay);
  }

  private emitWatcher(pending: PendingWatcherEvent): void {
    if (this.disposed) return;
    if (!this.getSettings().trackExternalChanges) return;
    const relPath = this.relPathFor(pending.uri, true);
    if (relPath === undefined) return;
    if (this.wasEmittedRecently(pending.kind, pending.uri)) return;
    this.markEmitted(pending.kind, pending.uri);
    this.append({ kind: pending.kind, relPath, source: "watcher" });
  }

  private append(draft: EventDraft): void {
    try {
      this.sink.append(draft);
    } catch (error) {
      this.logger.error(`Failed to record file event: ${safeMessage(error)}`);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values()) {
      if (pending.handle !== undefined) clearTimeout(pending.handle);
    }
    this.pending.clear();
    this.recent.clear();
    this.watcher = undefined;
    for (const disposable of this.disposables.splice(0)) {
      try {
        disposable.dispose();
      } catch {
        // ignore
      }
    }
    this.started = false;
  }
}

function safeDisplay(displayPath: (uri: vscode.Uri) => string, uri: vscode.Uri): string {
  try {
    return displayPath(uri);
  } catch {
    return "";
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
