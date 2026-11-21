import * as vscode from "vscode";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  dispose(): void;
}

/**
 * Output-channel logger.
 *
 * Privacy rules enforced by callers, documented here: never pass document text, terminal
 * command lines, URIs or absolute paths to this logger. Workspace-relative paths
 * (`displayPath` output) are the only path form allowed.
 */
export function createLogger(): Logger {
  const channel = vscode.window.createOutputChannel("CodeTrail", { log: true });
  let disposed = false;

  type Level = "info" | "warn" | "error" | "debug";

  const write = (level: Level, message: string): void => {
    if (disposed) return;
    try {
      if (level === "error") {
        channel.error(message);
      } else if (level === "warn") {
        channel.warn(message);
      } else if (level === "debug") {
        channel.debug(message);
      } else {
        channel.info(message);
      }
    } catch {
      // Logging must never break tracking.
    }
  };

  return {
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
    debug: (message) => write("debug", message),
    dispose: () => {
      disposed = true;
      try {
        channel.dispose();
      } catch {
        // ignore
      }
    },
  };
}
