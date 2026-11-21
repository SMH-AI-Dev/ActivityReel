import * as vscode from "vscode";
import type { Settings } from "../../shared/model";
import { readSettings } from "../config";
import type { Logger } from "../logger";
import { isExcluded } from "../pathUtils";
import { displayPath } from "../pathUtilsVscode";
import type { EventSink } from "../store/eventSink";
import { DocumentTracker } from "./documentTracker";
import { DebugTracker } from "./debugTracker";
import { FileTracker } from "./fileTracker";
import { SaveTracker } from "./saveTracker";
import { TaskTracker } from "./taskTracker";
import { TerminalTracker } from "./terminalTracker";

export interface TrackingControllerOptions {
  sink: EventSink;
  logger: Logger;
  getSettings?: () => Settings;
  now?: () => number;
}

export class TrackingController {
  private readonly sink: EventSink;
  private readonly logger: Logger;
  private readonly getSettings: () => Settings;
  private readonly now: () => number;

  private readonly disposables: vscode.Disposable[] = [];
  private documentTracker: DocumentTracker | undefined;
  private fileTracker: FileTracker | undefined;
  private saveTracker: SaveTracker | undefined;
  private taskTracker: TaskTracker | undefined;
  private debugTracker: DebugTracker | undefined;
  private terminalTracker: TerminalTracker | undefined;

  private configDisposable: vscode.Disposable | undefined;
  private started = false;
  private disposed = false;
  private paused = false;

  constructor(options: TrackingControllerOptions) {
    this.sink = options.sink;
    this.logger = options.logger;
    this.getSettings = options.getSettings ?? readSettings;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const settings = this.getSettings();
    this.configDisposable = subscribeSettingsChanged(() => this.onSettingsChanged());
    if (settings.enabled) {
      this.build(settings);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.teardownTrackers();
    this.configDisposable?.dispose();
    this.configDisposable = undefined;
    for (const disposable of this.disposables.splice(0)) {
      try {
        disposable.dispose();
      } catch {
        // ignore
      }
    }
    this.started = false;
  }

  /** Flushes pending bursts (never emits while paused), then toggles the paused state. */
  setPaused(value: boolean): void {
    if (this.paused === value || this.disposed) {
      this.paused = value;
      return;
    }
    if (value) {
      // Flush dirty bursts BEFORE entering paused so nothing is lost.
      this.documentTracker?.beginPause();
      this.paused = true;
      return;
    }
    this.paused = false;
    // Refresh snapshots to live text without emitting (paused edits never become one giant diff).
    this.documentTracker?.endPause();
  }

  isPaused(): boolean {
    return this.paused;
  }

  async flushAll(): Promise<void> {
    try {
      this.documentTracker?.flushAll();
    } catch (error) {
      this.logger.warn(`flushAll failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  isDocumentOpen(key: string): boolean {
    return this.documentTracker?.isOpen(key) ?? false;
  }

  snapshotForTest(): { paused: boolean; trackedDocuments: number } {
    return { paused: this.paused, trackedDocuments: this.documentTracker?.size ?? 0 };
  }

  // ---------------------------------------------------------------- internals

  private build(settings: Settings): void {
    const documentTracker = new DocumentTracker({
      sink: this.sink,
      logger: this.logger,
      getSettings: this.getSettings,
      now: this.now,
    });
    documentTracker.start();
    this.documentTracker = documentTracker;

    this.fileTracker = new FileTracker({
      sink: this.sink,
      logger: this.logger,
      getSettings: this.getSettings,
      isDocumentOpen: (key) => documentTracker.isOpen(key),
      isDocumentDirty: (key) => documentTracker.isDirty(key),
      displayPath: (uri) => displayPath(uri, vscode.workspace.workspaceFolders ?? []),
      exclude: (relPath) => isExcluded(relPath, this.getSettings().excludeGlobs),
      now: this.now,
    });
    this.fileTracker.start();

    this.saveTracker = new SaveTracker({
      sink: this.sink,
      logger: this.logger,
      isTracked: (key) => documentTracker.isOpen(key),
      flushDocument: (doc, key) => {
        if (documentTracker.isOpen(key)) {
          documentTracker.flushDocument(doc);
        }
      },
      displayPath: (uri) => displayPath(uri, vscode.workspace.workspaceFolders ?? []),
      exclude: (relPath) => isExcluded(relPath, this.getSettings().excludeGlobs),
      now: this.now,
    });
    this.saveTracker.start();

    if (settings.trackTasks) {
      this.taskTracker = new TaskTracker({
        sink: this.sink,
        logger: this.logger,
        getSettings: this.getSettings,
        now: this.now,
      });
      this.taskTracker.start();
    }
    if (settings.trackDebug) {
      this.debugTracker = new DebugTracker({
        sink: this.sink,
        logger: this.logger,
        getSettings: this.getSettings,
        now: this.now,
      });
      this.debugTracker.start();
    }
    if (settings.trackTerminal) {
      this.terminalTracker = new TerminalTracker({
        sink: this.sink,
        logger: this.logger,
        getSettings: this.getSettings,
        displayPath: (uri) => displayPath(uri, vscode.workspace.workspaceFolders ?? []),
        now: this.now,
      });
      this.terminalTracker.start();
    }

    if (this.paused) {
      // Rebuild while paused must not emit. The fresh tracker holds no dirty bursts, so it only
      // needs the paused flag; the paused state itself is preserved across rebuilds.
      documentTracker.beginPause();
    }
  }

  private teardownTrackers(): void {
    const trackers = [
      this.terminalTracker,
      this.debugTracker,
      this.taskTracker,
      this.saveTracker,
      this.fileTracker,
      this.documentTracker,
    ] as const;
    for (const tracker of trackers) {
      if (tracker === undefined) continue;
      try {
        tracker.dispose();
      } catch (error) {
        this.logger.warn(`Tracker dispose failed: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
    this.terminalTracker = undefined;
    this.debugTracker = undefined;
    this.taskTracker = undefined;
    this.saveTracker = undefined;
    this.fileTracker = undefined;
    this.documentTracker = undefined;
  }

  private onSettingsChanged(): void {
    if (this.disposed) return;
    const next = this.getSettings();
    // Snapshot bursts BEFORE disposing the trackers so nothing is lost.
    if (!this.paused) {
      this.documentTracker?.flushAll();
    }
    this.teardownTrackers();
    if (next.enabled) {
      this.build(next);
    }
  }
}

function subscribeSettingsChanged(cb: () => void): vscode.Disposable {
  try {
    return vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("activityreel")) cb();
    });
  } catch {
    return { dispose: () => undefined };
  }
}
