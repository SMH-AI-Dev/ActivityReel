import type { ActivityStore } from "./activityStore";
import { sanitizeEvent } from "./validate";

/**
 * Storage backend for the activity history. Implementations must make `write` atomic (temp file
 * plus rename) and must never keep the caller's error handling away from it.
 */
export interface StorageAdapter {
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
  remove(): Promise<void>;
  quarantine?(): Promise<void>;
}

export interface HistoryPersistenceOptions {
  debounceMs?: number;
  onError?: (error: unknown) => void;
}

export type LoadResult = "loaded" | "empty" | "newer" | "corrupt";

/** Fraction of well-formed-but-invalid events above which the file is treated as corrupt. */
const MALFORMED_EVENT_RATIO = 0.2;
const DEFAULT_DEBOUNCE_MS = 2000;

/**
 * Debounced, change-detecting persistence of the store snapshot.
 *
 * Pure relative to the host: all storage goes through the injected adapter and all timing through
 * `setTimeout`, so it is testable without VS Code. Change detection is purely revision-based (see
 * `fingerprint`), so the wall clock cannot force spurious rewrites.
 */
export class HistoryPersistence {
  private readonly store: ActivityStore;
  private readonly adapter: StorageAdapter;
  private readonly debounceMs: number;
  private readonly onError?: (error: unknown) => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastSavedFingerprint: string | undefined;
  private pending: Promise<void> | undefined;
  private disposed = false;

  constructor(store: ActivityStore, adapter: StorageAdapter, options: HistoryPersistenceOptions = {}) {
    this.store = store;
    this.adapter = adapter;
    const debounce = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.debounceMs = Number.isFinite(debounce) && debounce >= 0 ? debounce : DEFAULT_DEBOUNCE_MS;
    this.onError = options.onError;
  }

  /**
   * Reads and restores the history. `"empty"` means nothing stored yet, `"newer"` a file written
   * by a newer schema (quarantined, never overwritten here), `"corrupt"` unparseable or mostly
   * invalid data (quarantined, the store starts fresh).
   */
  async load(): Promise<LoadResult> {
    let text: string | undefined;
    try {
      text = await this.adapter.read();
    } catch (error) {
      this.report(error);
      return "empty";
    }
    if (text === undefined) return "empty";

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      this.report(error);
      await this.quarantine();
      return "corrupt";
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      await this.quarantine();
      return "corrupt";
    }

    const raw = parsed as Record<string, unknown>;
    const version = raw.v;
    if (typeof version !== "number") {
      await this.quarantine();
      return "corrupt";
    }
    if (version !== 1) {
      await this.quarantine();
      return "newer";
    }

    const events = Array.isArray(raw.events) ? raw.events : [];
    const valid = events.filter((event) => sanitizeEvent(event) !== undefined).length;
    const malformed = events.length - valid;
    const mostlyMalformed =
      events.length > 0 && malformed / events.length > MALFORMED_EVENT_RATIO;

    if (!this.store.load(parsed) || mostlyMalformed) {
      if (mostlyMalformed) this.store.clear();
      await this.quarantine();
      return "corrupt";
    }
    this.lastSavedFingerprint = this.fingerprint();
    return "loaded";
  }

  /** Arms the debounce timer; repeated calls collapse into one write. No-op when clean. */
  schedule(): void {
    if (this.disposed) return;
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.debounceMs);
    const handle = this.timer as unknown as { unref?: () => void };
    if (typeof handle.unref === "function") handle.unref();
  }

  /** Writes the snapshot if it changed since the last successful write. Errors never throw. */
  async flush(): Promise<void> {
    this.cancelTimer();
    if (this.pending) await this.pending;
    if (this.store.isEmpty()) {
      this.lastSavedFingerprint = undefined;
      return;
    }
    const text = JSON.stringify(this.store.serialize());
    const fingerprint = this.fingerprint();
    if (fingerprint === this.lastSavedFingerprint) return;
    const write = (async (): Promise<void> => {
      try {
        await this.adapter.write(text);
        this.lastSavedFingerprint = this.fingerprint();
      } catch (error) {
        this.report(error);
      }
    })();
    this.pending = write;
    try {
      await write;
    } finally {
      if (this.pending === write) this.pending = undefined;
    }
  }

  async dispose(): Promise<void> {
    await this.flush();
    this.disposed = true;
    this.cancelTimer();
  }

  /** Clears the store and removes the stored history (optionally quarantining it first). */
  async clear(quarantine = false): Promise<void> {
    this.cancelTimer();
    this.store.clear();
    this.lastSavedFingerprint = undefined;
    try {
      if (quarantine) await this.quarantine();
      else await this.adapter.remove();
    } catch (error) {
      this.report(error);
    }
  }

  /**
   * Identity plus mutation state of the store. Stable while the store is untouched (no clock
   * component), so a clean flush compares equal to the last saved value and writes nothing.
   */
  private fingerprint(): string {
    return `${this.store.sessionId}:${this.store.revision}`;
  }

  private async quarantine(): Promise<void> {
    if (!this.adapter.quarantine) return;
    try {
      await this.adapter.quarantine();
    } catch (error) {
      this.report(error);
    }
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private report(error: unknown): void {
    if (!this.onError) return;
    try {
      this.onError(error);
    } catch {
      // An error reporter must never break persistence.
    }
  }
}
