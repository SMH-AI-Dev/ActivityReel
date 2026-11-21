import * as vscode from "vscode";
import type { Settings } from "../../shared/model";
import type { Logger } from "../logger";
import type { EventSink } from "../store/eventSink";

export interface TaskTrackerOptions {
  sink: EventSink;
  logger: Logger;
  getSettings: () => Settings;
  now?: () => number;
}

interface TaskRecord {
  eventId: string;
  startedAt: number;
  status: "running" | "done" | "failed";
}

/**
 * Task lifecycle: start creates a running card, process end settles it with exitCode, task end
 * closes tasks that never spawned a process (never reported as failed).
 */
export class TaskTracker {
  private readonly sink: EventSink;
  private readonly logger: Logger;
  private readonly getSettings: () => Settings;
  private readonly now: () => number;

  private readonly records = new WeakMap<vscode.TaskExecution, TaskRecord>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(options: TaskTrackerOptions) {
    this.sink = options.sink;
    this.logger = options.logger;
    this.getSettings = options.getSettings;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    this.disposables.push(
      vscode.tasks.onDidStartTask((event) => this.onStart(event.execution)),
      vscode.tasks.onDidEndTaskProcess((event) => this.onEndProcess(event.execution, event.exitCode)),
      vscode.tasks.onDidEndTask((event) => this.onEnd(event.execution)),
    );
  }

  private onStart(execution: vscode.TaskExecution): void {
    if (!this.getSettings().trackTasks) return;
    let task: vscode.Task;
    try {
      task = execution.task;
    } catch {
      return;
    }
    const taskName = typeof task.name === "string" && task.name.length > 0 ? task.name : "task";
    const taskSource = typeof task.source === "string" ? task.source : "";
    const taskId = taskSource.length > 0 ? `${taskSource}:${taskName}` : taskName;
    try {
      const event = this.sink.append({
        kind: "task",
        taskName,
        taskSource,
        taskId,
        status: "running",
      });
      this.records.set(execution, { eventId: event.id, startedAt: this.now(), status: "running" });
    } catch (error) {
      this.logger.error(`Failed to record task start: ${safeMessage(error)}`);
    }
  }

  private onEndProcess(execution: vscode.TaskExecution, exitCode: number | undefined): void {
    if (!this.getSettings().trackTasks) return;
    const record = this.records.get(execution);
    if (record === undefined || record.status !== "running") return;
    this.records.delete(execution);
    const status = exitCode !== undefined && exitCode !== 0 ? "failed" : "done";
    record.status = status;
    this.update(record, { exitCode, durationMs: Math.max(0, this.now() - record.startedAt), status });
  }

  private onEnd(execution: vscode.TaskExecution): void {
    if (!this.getSettings().trackTasks) return;
    const record = this.records.get(execution);
    if (record === undefined || record.status !== "running") return;
    this.records.delete(execution);
    // No process events: the task finished without a reported exit code, not a failure.
    record.status = "done";
    this.update(record, { durationMs: Math.max(0, this.now() - record.startedAt), status: "done" });
  }

  private update(record: TaskRecord, patch: { exitCode?: number; durationMs: number; status: "done" | "failed" }): void {
    try {
      this.sink.update(record.eventId, patch);
    } catch (error) {
      this.logger.error(`Failed to update task event: ${safeMessage(error)}`);
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
