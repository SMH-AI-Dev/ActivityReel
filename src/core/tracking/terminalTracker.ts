import * as vscode from "vscode";
import type { Settings } from "../../shared/model";
import type { Logger } from "../logger";
import { isInsideWorkspace } from "../pathUtilsVscode";
import type { EventSink } from "../store/eventSink";

export interface TerminalTrackerOptions {
  sink: EventSink;
  logger: Logger;
  getSettings: () => Settings;
  /** Workspace-relative display label; only used when the cwd is inside the workspace. */
  displayPath: (uri: vscode.Uri) => string;
  now?: () => number;
}

interface ExecutionRecord {
  eventId: string;
  startedAt: number;
}

/**
 * Terminal shell integration. Command text is sensitive: it is stored in the local event log
 * only and must never appear in logs or error messages.
 */
export class TerminalTracker {
  private readonly sink: EventSink;
  private readonly logger: Logger;
  private readonly getSettings: () => Settings;
  private readonly displayPath: (uri: vscode.Uri) => string;
  private readonly now: () => number;

  private readonly executions = new WeakMap<vscode.TerminalShellExecution, ExecutionRecord>();
  private readonly disposables: vscode.Disposable[] = [];
  private unsupportedLogged = false;

  constructor(options: TerminalTrackerOptions) {
    this.sink = options.sink;
    this.logger = options.logger;
    this.getSettings = options.getSettings;
    this.displayPath = options.displayPath;
    this.now = options.now ?? Date.now;
  }

  /** Returns true when shell-integration events exist and listeners were attached. */
  start(): boolean {
    const win = vscode.window;
    const hasChange = typeof win.onDidChangeTerminalShellIntegration === "function";
    const hasStart = typeof win.onDidStartTerminalShellExecution === "function";
    const hasEnd = typeof win.onDidEndTerminalShellExecution === "function";
    if (!hasStart || !hasEnd) {
      if (!this.unsupportedLogged) {
        this.unsupportedLogged = true;
        this.logger.info("Terminal shell integration events are unavailable; terminal tracking is off.");
      }
      return false;
    }
    if (hasChange) {
      // Must be observed before commands run so late-attaching shells are covered; the
      // execution events already carry everything we need, so nothing is stored here.
      this.disposables.push(
        win.onDidChangeTerminalShellIntegration(() => {
          // Intentionally empty: subscription ordering only.
        }),
      );
    }
    this.disposables.push(
      win.onDidStartTerminalShellExecution((event) => this.onStart(event.execution)),
      win.onDidEndTerminalShellExecution((event) => this.onEnd(event.execution, event.exitCode)),
    );
    return true;
  }

  private cwdFor(execution: vscode.TerminalShellExecution): string | undefined {
    let cwd: vscode.Uri | undefined;
    try {
      cwd = execution.cwd;
    } catch {
      return undefined;
    }
    if (cwd === undefined || cwd.scheme !== "file") return undefined;
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!isInsideWorkspace(cwd, folders)) return undefined;
    try {
      const label = this.displayPath(cwd);
      return label.length > 0 ? label : undefined;
    } catch {
      return undefined;
    }
  }

  private commandFor(execution: vscode.TerminalShellExecution): string {
    try {
      const value = execution.commandLine?.value;
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  }

  private onStart(execution: vscode.TerminalShellExecution): void {
    if (!this.getSettings().trackTerminal) return;
    if (this.executions.has(execution)) return;
    try {
      const event = this.sink.append({
        kind: "terminal",
        command: this.commandFor(execution),
        cwd: this.cwdFor(execution),
        status: "running",
      });
      this.executions.set(execution, { eventId: event.id, startedAt: this.now() });
    } catch (error) {
      // Never include command text in the error path.
      this.logger.error(`Failed to record terminal start: ${safeMessage(error)}`);
    }
  }

  private onEnd(execution: vscode.TerminalShellExecution, exitCode: number | undefined): void {
    if (!this.getSettings().trackTerminal) return;
    const record = this.executions.get(execution);
    if (record === undefined) return;
    this.executions.delete(execution);
    const failed = exitCode !== undefined && exitCode !== 0;
    try {
      this.sink.update(record.eventId, {
        command: this.commandFor(execution),
        cwd: this.cwdFor(execution),
        exitCode,
        durationMs: Math.max(0, this.now() - record.startedAt),
        status: failed ? "failed" : "done",
      });
    } catch (error) {
      this.logger.error(`Failed to record terminal end: ${safeMessage(error)}`);
    }
  }

  dispose(): void {
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
