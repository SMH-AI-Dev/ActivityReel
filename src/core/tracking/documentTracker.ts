import * as vscode from "vscode";
import { LIMITS } from "../../shared/constants";
import type {
  DiffHunk,
  DiffMode,
  DiffStat,
  EditEvent,
  EventDraft,
  Settings,
  TextEditReason,
} from "../../shared/model";
import { diffText } from "../diff/diffEngine";
import type { Logger } from "../logger";
import { byteLength, isExcluded, untitledLabel } from "../pathUtils";
import {
  displayPath,
  isInsideWorkspace,
  isTrackableScheme,
  uriKey,
} from "../pathUtilsVscode";
import type { EventSink } from "../store/eventSink";

/** Total snapshot text bytes across all tracked documents. */
export const SNAPSHOT_BYTE_BUDGET = 64 * 1024 * 1024;

export interface DocumentTrackerOptions {
  sink: EventSink;
  logger: Logger;
  getSettings: () => Settings;
  now?: () => number;
}

interface Snapshot {
  key: string;
  uri: vscode.Uri;
  relPath: string;
  languageId: string;
  text: string;
  version: number;
  eol: "\n" | "\r\n";
  burstReason?: TextEditReason;
  burstStartedAt?: number;
  timer?: ReturnType<typeof setTimeout>;
  dirty: boolean;
}

/**
 * Tracks edit bursts. The change handler only marks documents dirty and arms timers; all diff
 * work happens in `flushDocument` on idle timeout or hard-flush deadline. Documents are never
 * mutated and Node `fs`/`path` are never used.
 */
export class DocumentTracker {
  private readonly sink: EventSink;
  private readonly logger: Logger;
  private readonly getSettings: () => Settings;
  private readonly now: () => number;

  private readonly snapshots = new Map<string, Snapshot>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly disposables: vscode.Disposable[] = [];

  private snapshotBytes = 0;
  private budgetWarned = false;
  private paused = false;
  private attached = false;
  private disposed = false;
  private refreshing = false;

  constructor(options: DocumentTrackerOptions) {
    this.sink = options.sink;
    this.logger = options.logger;
    this.getSettings = options.getSettings;
    this.now = options.now ?? Date.now;
  }

  /** Snapshot open documents and subscribe to document/editor events. Cheap and synchronous. */
  start(): void {
    if (this.attached || this.disposed) return;
    this.attached = true;
    for (const doc of vscode.workspace.textDocuments ?? []) {
      this.trackDocument(doc);
    }
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this.onOpen(doc)),
      vscode.workspace.onDidChangeTextDocument((event) => this.onChange(event)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.onClose(doc)),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        // The save event is emitted by SaveTracker after it flushes; here we only keep the
        // snapshot version truthful if anything skipped the flush.
        const snapshot = this.snapshots.get(uriKey(doc.uri));
        if (snapshot !== undefined && !snapshot.dirty && snapshot.version !== doc.version) {
          snapshot.version = doc.version;
        }
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.onVisibleEditorsChanged()),
    );
  }

  // ---------------------------------------------------------------- eligibility / snapshots

  private relPathFor(doc: vscode.TextDocument): string | undefined {
    if (!isTrackableScheme(doc.uri)) return undefined;
    if (doc.uri.scheme === "untitled") return untitledLabel(doc.uri);
    const folders = vscode.workspace.workspaceFolders ?? [];
    const inside = isInsideWorkspace(doc.uri, folders);
    if (!inside && !this.getSettings().openFilesOutsideWorkspace) return undefined;
    return displayPath(doc.uri, folders);
  }

  private tooLarge(doc: vscode.TextDocument): boolean {
    const limitBytes = Math.max(1, this.getSettings().maxFileSizeKB) * 1024;
    let text: string;
    try {
      text = doc.getText();
    } catch {
      return true;
    }
    // Characters are never more than 4 UTF-8 bytes, so skip the encode for clearly small docs.
    if (text.length > limitBytes) return true;
    if (text.length * 4 <= limitBytes) return false;
    // Multi-byte text can exceed the byte budget with fewer characters.
    return byteLength(text) > limitBytes;
  }

  private isEligible(doc: vscode.TextDocument): string | undefined {
    if (this.disposed || doc.isClosed) return undefined;
    let relPath: string | undefined;
    try {
      relPath = this.relPathFor(doc);
    } catch {
      return undefined;
    }
    if (relPath === undefined) return undefined;
    if (doc.uri.scheme !== "untitled" && isExcluded(relPath, this.getSettings().excludeGlobs)) {
      return undefined;
    }
    try {
      if (this.tooLarge(doc)) return undefined;
    } catch {
      return undefined;
    }
    return relPath;
  }

  private trackDocument(doc: vscode.TextDocument): Snapshot | undefined {
    const key = uriKey(doc.uri);
    const existing = this.snapshots.get(key);
    if (existing !== undefined) return existing;
    const relPath = this.isEligible(doc);
    if (relPath === undefined) return undefined;
    let text: string;
    try {
      text = doc.getText();
    } catch {
      return undefined;
    }
    const bytes = byteLength(text);
    if (this.snapshotBytes + bytes > SNAPSHOT_BYTE_BUDGET) {
      if (!this.budgetWarned) {
        this.budgetWarned = true;
        this.logger.warn("Document snapshot memory budget reached; additional files are not tracked.");
      }
      return undefined;
    }
    const snapshot: Snapshot = {
      key,
      uri: doc.uri,
      relPath,
      languageId: doc.languageId,
      text,
      version: doc.version,
      eol: doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
      dirty: false,
    };
    this.snapshots.set(key, snapshot);
    this.snapshotBytes += bytes;
    return snapshot;
  }

  private setSnapshotText(snapshot: Snapshot, text: string): void {
    this.snapshotBytes += byteLength(text) - byteLength(snapshot.text);
    snapshot.text = text;
  }

  private dropSnapshot(snapshot: Snapshot): void {
    this.clearTimer(snapshot);
    this.snapshotBytes -= byteLength(snapshot.text);
    snapshot.text = "";
    this.snapshots.delete(snapshot.key);
  }

  // ---------------------------------------------------------------- event handlers

  private onOpen(doc: vscode.TextDocument): void {
    if (this.disposed) return;
    const key = uriKey(doc.uri);
    const existing = this.snapshots.get(key);
    if (existing !== undefined) {
      // Language changes can re-fire open events; refresh metadata without emitting.
      existing.languageId = doc.languageId;
      existing.eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
      return;
    }
    this.trackDocument(doc);
  }

  private onChange(event: vscode.TextDocumentChangeEvent): void {
    if (this.disposed || this.paused || this.refreshing) return;
    if (event.contentChanges.length === 0) return;
    const key = uriKey(event.document.uri);
    const snapshot = this.snapshots.get(key);
    if (snapshot === undefined) {
      // A document that became editable after the snapshot (e.g. setting change); only
      // snapshot lazily when eligible, which also respects size and glob gates.
      this.trackDocument(event.document);
      return;
    }
    const reason = toTextEditReason(event.reason);
    if (!snapshot.dirty) {
      snapshot.dirty = true;
      snapshot.burstStartedAt = this.now();
      snapshot.burstReason = reason;
    } else if (reason !== snapshot.burstReason) {
      this.flushSnapshot(snapshot, event.document, true);
      if (!this.snapshots.has(key)) return;
      snapshot.dirty = true;
      snapshot.burstStartedAt = this.now();
      snapshot.burstReason = reason;
    }
    this.armTimers(snapshot);
  }

  private armTimers(snapshot: Snapshot): void {
    this.clearTimer(snapshot);
    const now = this.now();
    const { debounceMs } = this.getSettings();
    const startedAt = snapshot.burstStartedAt ?? now;
    const deadline = startedAt + LIMITS.debounceMaxFlushMs;
    const idleDelay = Math.max(0, Math.min(debounceMs, deadline - now));
    const timerId = setTimeout(() => {
      this.timers.delete(timerId);
      if (snapshot.timer !== timerId) return;
      snapshot.timer = undefined;
      this.runFlush(snapshot);
    }, idleDelay);
    snapshot.timer = timerId;
    this.timers.add(timerId);
  }

  private clearTimer(snapshot: Snapshot): void {
    if (snapshot.timer === undefined) return;
    clearTimeout(snapshot.timer);
    this.timers.delete(snapshot.timer);
    snapshot.timer = undefined;
  }

  private onClose(doc: vscode.TextDocument): void {
    if (this.disposed) return;
    const key = uriKey(doc.uri);
    const snapshot = this.snapshots.get(key);
    if (snapshot === undefined) return;
    if (snapshot.dirty) this.flushSnapshot(snapshot, doc, true);
    this.dropSnapshot(snapshot);
  }

  private onVisibleEditorsChanged(): void {
    if (this.disposed || this.paused) return;
    if (!this.hasDirty()) return;
    const visible = new Set<string>();
    for (const editor of vscode.window.visibleTextEditors ?? []) {
      visible.add(uriKey(editor.document.uri));
    }
    for (const snapshot of [...this.snapshots.values()]) {
      if (!snapshot.dirty || visible.has(snapshot.key)) continue;
      const doc = findDocument(snapshot.key);
      if (doc === undefined || doc.isClosed) {
        this.dropSnapshot(snapshot);
        continue;
      }
      this.flushSnapshot(snapshot, doc, true);
    }
  }

  // ---------------------------------------------------------------- flushing

  private runFlush(snapshot: Snapshot): void {
    if (this.disposed) return;
    const doc = findDocument(snapshot.key);
    this.flushSnapshot(snapshot, doc, false);
  }

  /**
   * Flushes one snapshot. `force` ignores pause and reads the live document even when it is no
   * longer visible; otherwise paused state defers the read (paused snapshots refresh on resume).
   */
  private flushSnapshot(
    snapshot: Snapshot,
    doc: vscode.TextDocument | undefined,
    force: boolean,
  ): void {
    this.clearTimer(snapshot);
    const dirty = snapshot.dirty;
    snapshot.dirty = false;

    if (!dirty) return;

    if (this.disposed) {
      snapshot.burstReason = undefined;
      snapshot.burstStartedAt = undefined;
      return;
    }

    if (this.paused && !force) {
      // Keep the burst pending; resume refreshes snapshots without emitting.
      return;
    }

    if (doc === undefined || doc.isClosed) {
      // Nothing truthful to diff against; keep the last text as the base for the next edit.
      snapshot.burstReason = undefined;
      snapshot.burstStartedAt = undefined;
      snapshot.version = doc?.version ?? snapshot.version;
      return;
    }

    const settings = this.getSettings();
    const relPath = this.isEligible(doc);
    if (relPath === undefined) {
      // Excluded / too large / outside workspace now: drop the accumulated burst silently but
      // keep a truthful base so later flushes do not attribute old text to new edits.
      let next: string | undefined;
      try {
        next = doc.getText();
      } catch {
        next = undefined;
      }
      if (next !== undefined) {
        this.setSnapshotText(snapshot, next);
        snapshot.version = doc.version;
      }
      snapshot.burstReason = undefined;
      snapshot.burstStartedAt = undefined;
      return;
    }

    snapshot.relPath = relPath;
    snapshot.languageId = doc.languageId;
    snapshot.eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";

    let next: string;
    try {
      next = doc.getText();
    } catch {
      snapshot.burstReason = undefined;
      snapshot.burstStartedAt = undefined;
      return;
    }
    const previous = snapshot.text;
    snapshot.burstReason = undefined;
    snapshot.burstStartedAt = undefined;

    if (next === previous) {
      snapshot.version = doc.version;
      return;
    }

    let stat: DiffStat;
    let hunks: DiffHunk[];
    let mode: DiffMode;
    let fullAvailable: boolean;
    let unified: string;
    try {
      const result = diffText(previous, next, {
        contextLines: settings.contextLines,
        maxDiffLines: settings.maxDiffLines,
      });
      stat = result.stat;
      hunks = result.hunks;
      mode = result.mode;
      fullAvailable = result.fullAvailable;
      unified = result.unified;
    } catch (error) {
      this.logger.warn(`Diff failed for ${relPath}: ${safeErrorMessage(error)}`);
      this.setSnapshotText(snapshot, next);
      snapshot.version = doc.version;
      return;
    }

    if (stat.added === 0 && stat.removed === 0 && !stat.truncated) {
      // EOL-only or otherwise invisible change: update the base, emit nothing.
      this.setSnapshotText(snapshot, next);
      snapshot.version = doc.version;
      return;
    }

    const draft: EventDraft = {
      kind: "edit",
      relPath,
      languageId: snapshot.languageId,
      diff: stat,
      eol: snapshot.eol,
      searchText: searchTextFor(previous, next),
      ...(reasonPatch(snapshot.burstReason)),
    };

    try {
      const event = this.sink.append(draft) as EditEvent;
      this.sink.attachDiff(event.id, {
        eventId: event.id,
        hunks,
        stat,
        mode,
        fullAvailable,
        unified,
      });
    } catch (error) {
      this.logger.error(`Failed to record edit for ${relPath}: ${safeErrorMessage(error)}`);
    }

    this.setSnapshotText(snapshot, next);
    snapshot.version = doc.version;
  }

  // ---------------------------------------------------------------- public API

  /** Called by SaveTracker before appending the save event. */
  flushDocument(doc: vscode.TextDocument): void {
    const snapshot = this.snapshots.get(uriKey(doc.uri));
    if (snapshot === undefined) return;
    if (!snapshot.dirty) {
      if (snapshot.version !== doc.version) snapshot.version = doc.version;
      return;
    }
    this.flushSnapshot(snapshot, doc, true);
  }

  /** Flushes a tracked document by key (used by SaveTracker/tests). */
  flushDocumentByKey(key: string): void {
    const snapshot = this.snapshots.get(key);
    if (snapshot === undefined) return;
    const doc = findDocument(key);
    this.flushSnapshot(snapshot, doc, true);
  }

  isOpen(key: string): boolean {
    return this.snapshots.has(key);
  }

  /** True when the tracked document has unflushed edits. */
  isDirty(key: string): boolean {
    return this.snapshots.get(key)?.dirty ?? false;
  }

  hasDirty(): boolean {
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.dirty) return true;
    }
    return false;
  }

  /** Flush every pending burst, reading live document text. */
  flushAll(): void {
    for (const snapshot of [...this.snapshots.values()]) {
      if (!snapshot.dirty) continue;
      const doc = findDocument(snapshot.key);
      this.flushSnapshot(snapshot, doc, true);
    }
  }

  /** Stop emitting and clear bursts before entering the paused state. */
  beginPause(): void {
    this.flushAll();
    this.paused = true;
  }

  /** Re-read every snapshot without emitting so paused edits are not attributed later. */
  endPause(): void {
    this.paused = false;
    this.refreshing = true;
    try {
      for (const snapshot of [...this.snapshots.values()]) {
        const doc = findDocument(snapshot.key);
        if (doc === undefined || doc.isClosed) {
          this.dropSnapshot(snapshot);
          continue;
        }
        const relPath = this.isEligible(doc);
        if (relPath === undefined) {
          this.dropSnapshot(snapshot);
          continue;
        }
        let text: string;
        try {
          text = doc.getText();
        } catch {
          continue;
        }
        this.setSnapshotText(snapshot, text);
        snapshot.version = doc.version;
        snapshot.relPath = relPath;
        snapshot.languageId = doc.languageId;
        snapshot.eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
        snapshot.dirty = false;
        snapshot.burstReason = undefined;
        snapshot.burstStartedAt = undefined;
        this.clearTimer(snapshot);
      }
    } finally {
      this.refreshing = false;
    }
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get size(): number {
    return this.snapshots.size;
  }

  dispose(): void {
    if (this.disposed) return;
    if (!this.paused) {
      try {
        this.flushAll();
      } catch {
        // never throw during dispose
      }
    }
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const snapshot of this.snapshots.values()) {
      snapshot.timer = undefined;
      snapshot.text = "";
    }
    this.snapshots.clear();
    this.snapshotBytes = 0;
    for (const disposable of this.disposables.splice(0)) {
      try {
        disposable.dispose();
      } catch {
        // ignore
      }
    }
    this.attached = false;
  }
}

function toTextEditReason(reason: vscode.TextDocumentChangeReason | undefined): TextEditReason | undefined {
  if (reason === vscode.TextDocumentChangeReason.Undo) return "undo";
  if (reason === vscode.TextDocumentChangeReason.Redo) return "redo";
  return undefined;
}

function reasonPatch(reason: TextEditReason | undefined): { reason?: TextEditReason } {
  return reason === undefined ? {} : { reason };
}

function findDocument(key: string): vscode.TextDocument | undefined {
  for (const doc of vscode.workspace.textDocuments ?? []) {
    if (uriKey(doc.uri) === key) return doc;
  }
  return undefined;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") return error.message;
  return "unknown error";
}

/**
 * First `LIMITS.searchTextMaxChars` characters of changed added/removed line text. Line content
 * only (never paths), matching the contract for the feed search index.
 */
export function searchTextFor(previous: string, next: string): string | undefined {
  const before = splitLines(previous);
  const after = splitLines(next);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const parts: string[] = [];
  let length = 0;
  for (const line of after) {
    if (beforeSet.has(line)) continue;
    const piece = line.trim();
    if (piece.length === 0) continue;
    parts.push(piece);
    length += piece.length + (parts.length > 1 ? 1 : 0);
    if (length >= LIMITS.searchTextMaxChars) break;
  }
  if (length < LIMITS.searchTextMaxChars) {
    for (const line of before) {
      if (afterSet.has(line)) continue;
      const piece = line.trim();
      if (piece.length === 0) continue;
      parts.push(piece);
      length += piece.length + 1;
      if (length >= LIMITS.searchTextMaxChars) break;
    }
  }
  if (parts.length === 0) return undefined;
  const joined = parts.join("\n");
  return joined.length > LIMITS.searchTextMaxChars
    ? joined.slice(0, LIMITS.searchTextMaxChars)
    : joined;
}

/** EOL-aware split without phantom final line. */
export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "" && /\r\n|\r|\n$/.test(text)) {
    lines.pop();
  }
  return lines;
}

