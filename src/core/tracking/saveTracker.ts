import * as vscode from "vscode";
import { LIMITS } from "../../shared/constants";
import type { Logger } from "../logger";
import { isTrackableScheme, uriKey } from "../pathUtilsVscode";
import type { EventSink } from "../store/eventSink";

export interface SaveTrackerOptions {
  sink: EventSink;
  logger: Logger;
  /** True when the document is tracked by the DocumentTracker. */
  isTracked: (key: string) => boolean;
  /** Flush the pending edit burst synchronously before the save card is appended. */
  flushDocument: (doc: vscode.TextDocument, key: string) => void;
  /** Workspace-relative (or basename) display label. */
  displayPath: (uri: vscode.Uri) => string;
  /** Exclude glob check for the relative path. */
  exclude: (relPath: string) => boolean;
  now?: () => number;
}

/**
 * Emits one `save` event per document per `LIMITS.saveStormMs` window (autosave, format-on-save).
 * `onDidSaveTextDocument` is authoritative; `onWillSave` is never used.
 */
export class SaveTracker {
  private readonly sink: EventSink;
  private readonly logger: Logger;
  private readonly isTracked: (key: string) => boolean;
  private readonly flushDocument: (doc: vscode.TextDocument, key: string) => void;
  private readonly displayPath: (uri: vscode.Uri) => string;
  private readonly exclude: (relPath: string) => boolean;
  private readonly now: () => number;

  private readonly lastEmitted = new Map<string, number>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(options: SaveTrackerOptions) {
    this.sink = options.sink;
    this.logger = options.logger;
    this.isTracked = options.isTracked;
    this.flushDocument = options.flushDocument;
    this.displayPath = options.displayPath;
    this.exclude = options.exclude;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => this.onSave(doc)),
    );
  }

  private onSave(doc: vscode.TextDocument): void {
    const uri = doc.uri;
    if (!isTrackableScheme(uri) || uri.scheme !== "file") return;
    const key = uriKey(uri);
    if (!this.isTracked(key)) return;
    let relPath: string;
    try {
      relPath = this.displayPath(uri);
    } catch {
      return;
    }
    if (relPath.length === 0) return;
    if (this.exclude(relPath)) return;

    try {
      this.flushDocument(doc, key);
    } catch (error) {
      this.logger.warn(`Flush before save failed: ${safeMessage(error)}`);
    }

    const now = this.now();
    const last = this.lastEmitted.get(key);
    // Fixed per-emission window: a suppressed save must not extend it, or continuous autosave
    // would never emit.
    if (last !== undefined && now - last < LIMITS.saveStormMs) return;
    this.lastEmitted.set(key, now);
    if (this.lastEmitted.size > 2048) this.prune(now);

    try {
      this.sink.append({ kind: "save", relPath, source: "editor" });
    } catch (error) {
      this.logger.error(`Failed to record save event: ${safeMessage(error)}`);
    }
  }

  private prune(now: number): void {
    for (const [key, at] of this.lastEmitted) {
      if (now - at >= LIMITS.saveStormMs) this.lastEmitted.delete(key);
    }
  }

  dispose(): void {
    this.lastEmitted.clear();
    for (const disposable of this.disposables.splice(0)) {
      try {
        disposable.dispose();
      } catch {
        // ignore
      }
    }
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
