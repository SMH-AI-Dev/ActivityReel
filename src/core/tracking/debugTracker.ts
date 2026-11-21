import * as vscode from "vscode";
import type { Settings } from "../../shared/model";
import type { Logger } from "../logger";
import type { EventSink } from "../store/eventSink";

export interface DebugTrackerOptions {
  sink: EventSink;
  logger: Logger;
  getSettings: () => Settings;
  now?: () => number;
}

/**
 * One card per debug session. Restarts produce a terminate + start pair and are intentionally
 * kept as two truthful cards (no coalescing).
 */
export class DebugTracker {
  private readonly sink: EventSink;
  private readonly logger: Logger;
  private readonly getSettings: () => Settings;
  private readonly now: () => number;

  private readonly sessions = new Map<string, { eventId: string; startedAt: number }>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(options: DebugTrackerOptions) {
    this.sink = options.sink;
    this.logger = options.logger;
    this.getSettings = options.getSettings;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    this.disposables.push(
      vscode.debug.onDidStartDebugSession((session) => this.onStart(session)),
      vscode.debug.onDidTerminateDebugSession((session) => this.onTerminate(session)),
    );
  }

  private onStart(session: vscode.DebugSession): void {
    if (!this.getSettings().trackDebug) return;
    const id = typeof session.id === "string" ? session.id : "";
    if (id.length === 0) return;
    const previous = this.sessions.get(id);
    if (previous !== undefined) {
      // Same session id restarted without a terminate event: settle the stale card first.
      try {
        this.sink.update(previous.eventId, {
          status: "done",
          durationMs: Math.max(0, this.now() - previous.startedAt),
        });
      } catch {
        // best effort
      }
      this.sessions.delete(id);
    }
    try {
      const event = this.sink.append({
        kind: "debug",
        debugName: typeof session.name === "string" && session.name.length > 0 ? session.name : "debug",
        debugType: typeof session.type === "string" ? session.type : "unknown",
        debugSessionId: id,
        status: "running",
      });
      this.sessions.set(id, { eventId: event.id, startedAt: this.now() });
    } catch (error) {
      this.logger.error(`Failed to record debug start: ${safeMessage(error)}`);
    }
  }

  private onTerminate(session: vscode.DebugSession): void {
    if (!this.getSettings().trackDebug) return;
    const id = typeof session.id === "string" ? session.id : "";
    const record = this.sessions.get(id);
    if (record === undefined) return;
    this.sessions.delete(id);
    try {
      this.sink.update(record.eventId, {
        status: "done",
        durationMs: Math.max(0, this.now() - record.startedAt),
      });
    } catch (error) {
      this.logger.error(`Failed to record debug end: ${safeMessage(error)}`);
    }
  }

  dispose(): void {
    this.sessions.clear();
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
