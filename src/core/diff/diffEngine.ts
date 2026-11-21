import type { DiffHunk, DiffMode, DiffStat } from "../../shared/model";
import { LIMITS } from "../../shared/constants";
import { toHunks } from "./hunks";
import { myers } from "./myers";
import { weightedDp } from "./weightedDp";
import type { AlignContext, AlignResult, EditStep, OperationLine } from "./types";

export type { OperationLine } from "./types";
export { toHunks } from "./hunks";
export { attachWordDiff } from "./wordDiff";
export type { WordDiffOptions } from "./wordDiff";

export interface DiffOptions {
  /** Unchanged lines shown around each change. Default 3. */
  contextLines?: number;
  /** Maximum number of operation lines kept for display. Default 500. */
  maxDiffLines?: number;
  /** Soft time budget for the line alignment in ms. Default `LIMITS.diffTimeBudgetMs`. */
  maxTimeMs?: number;
  /** Injectable clock (epoch ms); defaults to `Date.now`. */
  now?: () => number;
}

export interface DiffResult {
  hunks: DiffHunk[];
  stat: DiffStat;
  unified: string;
  fullAvailable: boolean;
  mode: DiffMode;
}

const DEFAULT_CONTEXT_LINES = 3;
const DEFAULT_MAX_DIFF_LINES = 500;
const LINE_SPLIT_RE = /\r\n|\r|\n/;

/**
 * Compute a line diff between two texts.
 *
 * Pure and deterministic for a given `now`; no I/O and no external dependencies.
 * Returns hunks limited to `maxDiffLines` operation lines for display, a stat computed
 * from the full diff, and a unified diff (paths are not known, so `before`/`after`).
 */
export function diffText(oldText: string, newText: string, options?: DiffOptions): DiffResult {
  const contextLines = resolveCount(options?.contextLines, DEFAULT_CONTEXT_LINES);
  const maxDiffLines = resolveCount(options?.maxDiffLines, DEFAULT_MAX_DIFF_LINES);
  const maxTimeMs = resolveTimeBudget(options?.maxTimeMs);
  const now = resolveNow(options?.now);

  const full = computeFullOperations(oldText, newText, maxTimeMs, now);

  const stat: DiffStat = { added: 0, removed: 0, hunks: 0, truncated: full.mode === "coarse" };
  for (const op of full.operations) {
    if (op.kind === "added") stat.added++;
    else if (op.kind === "removed") stat.removed++;
  }
  stat.hunks = toHunks(full.operations, contextLines).length;

  const displayed = full.operations.slice(0, maxDiffLines);
  const displayTruncated = displayed.length < full.operations.length;
  const coarse = full.mode === "coarse";
  const truncated = displayTruncated || coarse;
  stat.truncated = truncated;

  const hunks = toHunks(displayed, contextLines);
  const unified = buildUnified(hunks);
  const fullAvailable = !truncated && unified.complete;

  return {
    hunks,
    stat,
    unified: unified.text,
    fullAvailable,
    mode: full.mode,
  };
}

export interface DiffOperationsResult {
  /** Full operation list with 1-based line numbers (all context, added and removed lines). */
  operations: OperationLine[];
  mode: DiffMode;
}

/**
 * Test/utility path: the complete operation list (no display cap) plus the diff mode.
 * `diffText` is the primary API used by trackers and the host.
 */
export function diffOperations(
  oldText: string,
  newText: string,
  options?: Pick<DiffOptions, "maxTimeMs" | "now">,
): DiffOperationsResult {
  const maxTimeMs = resolveTimeBudget(options?.maxTimeMs);
  const now = resolveNow(options?.now);
  const full = computeFullOperations(oldText, newText, maxTimeMs, now);
  return { operations: full.operations, mode: full.mode };
}

interface FullDiff {
  operations: OperationLine[];
  mode: DiffMode;
}

function computeFullOperations(
  oldText: string,
  newText: string,
  maxTimeMs: number,
  now: () => number,
): FullDiff {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  if (oldText === newText) return { operations: identityOperations(oldLines), mode: "exact" };

  if (sameLines(oldLines, newLines)) {
    // Same lines but different text: an EOL-only change (CRLF vs LF) or a trailing-newline
    // change. Report the last line as a 1:1 replacement, matching what `diff` shows.
    return { operations: lastLineReplaceOperations(oldLines), mode: "exact" };
  }

  const deadline = maxTimeMs === Infinity ? Infinity : now() + maxTimeMs;

  let prefix = 0;
  const maxPrefix = Math.min(oldLines.length, newLines.length);
  while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) prefix++;

  let suffix = 0;
  const maxSuffix = Math.min(oldLines.length, newLines.length) - prefix;
  while (
    suffix < maxSuffix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);

  const align = alignMiddle(oldMiddle, newMiddle, deadline, now);
  const middleOps =
    align.steps === null
      ? coarseOperations(oldLines, newLines, prefix, suffix)
      : stepsToOperations(align.steps, oldMiddle, newMiddle, prefix);

  const operations: OperationLine[] = [];
  for (let i = 0; i < prefix; i++) {
    operations.push({ kind: "context", text: oldLines[i], oldLine: i + 1, newLine: i + 1 });
  }
  for (const op of middleOps) operations.push(op);
  const oldSuffixBase = oldLines.length - suffix;
  for (let s = 0; s < suffix; s++) {
    const o = oldSuffixBase + s;
    operations.push({ kind: "context", text: oldLines[o], oldLine: o + 1, newLine: newLines.length - suffix + s + 1 });
  }

  return { operations, mode: align.steps === null ? "coarse" : "exact" };
}

function alignMiddle(
  oldMiddle: readonly string[],
  newMiddle: readonly string[],
  deadline: number,
  now: () => number,
): AlignResult {
  if (oldMiddle.length === 0 && newMiddle.length === 0) {
    return { steps: [], algorithm: "dp" };
  }
  const sum = oldMiddle.length + newMiddle.length;
  const ctx: AlignContext = { oldMiddle, newMiddle, deadline, now };
  if (sum < LIMITS.dpLineSumLimit && oldMiddle.length * newMiddle.length <= LIMITS.dpCellLimit) {
    return weightedDp(ctx);
  }
  if (sum > LIMITS.myersMaxMiddleLines) return { steps: null, algorithm: "coarse" };
  return myers(ctx, LIMITS.myersMaxEditDistance);
}

/**
 * Map trimmed-middle steps to operations. `base` is the number of trimmed common prefix
 * lines, which is the same on both sides; all suffix lines come after the middle.
 */
function stepsToOperations(
  steps: readonly EditStep[],
  oldMiddle: readonly string[],
  newMiddle: readonly string[],
  base: number,
): OperationLine[] {
  const ops: OperationLine[] = [];
  for (const step of steps) {
    if (step.kind === "equal") {
      ops.push({
        kind: "context",
        text: oldMiddle[step.a],
        oldLine: base + step.a + 1,
        newLine: base + step.b + 1,
      });
    } else if (step.kind === "remove") {
      ops.push({ kind: "removed", text: oldMiddle[step.a], oldLine: base + step.a + 1 });
    } else {
      ops.push({ kind: "added", text: newMiddle[step.b], newLine: base + step.b + 1 });
    }
  }
  return ops;
}

function coarseOperations(
  oldLines: readonly string[],
  newLines: readonly string[],
  prefix: number,
  suffix: number,
): OperationLine[] {
  const ops: OperationLine[] = [];
  for (let i = 0; i < prefix; i++) {
    ops.push({ kind: "context", text: oldLines[i], oldLine: i + 1, newLine: i + 1 });
  }
  const oldEnd = oldLines.length - suffix;
  for (let o = prefix; o < oldEnd; o++) {
    ops.push({ kind: "removed", text: oldLines[o], oldLine: o + 1 });
  }
  const newEnd = newLines.length - suffix;
  for (let nn = prefix; nn < newEnd; nn++) {
    ops.push({ kind: "added", text: newLines[nn], newLine: nn + 1 });
  }
  for (let s = 0; s < suffix; s++) {
    const o = oldEnd + s;
    ops.push({ kind: "context", text: oldLines[o], oldLine: o + 1, newLine: newEnd + s + 1 });
  }
  return ops;
}

function identityOperations(lines: readonly string[]): OperationLine[] {
  return lines.map((text, i) => ({ kind: "context", text, oldLine: i + 1, newLine: i + 1 }));
}

/** Context for all lines but the last, then a 1:1 `removed`/`added` replacement of it. */
function lastLineReplaceOperations(lines: readonly string[]): OperationLine[] {
  const ops: OperationLine[] = [];
  if (lines.length === 0) return ops;
  const last = lines.length - 1;
  for (let i = 0; i < last; i++) {
    ops.push({ kind: "context", text: lines[i], oldLine: i + 1, newLine: i + 1 });
  }
  ops.push({ kind: "removed", text: lines[last], oldLine: lines.length });
  ops.push({ kind: "added", text: lines[last], newLine: lines.length });
  return ops;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(LINE_SPLIT_RE);
  // A trailing newline terminates the last line; it does not create a phantom empty line.
  // Dropping it here keeps "a\nb" and "a\nb\n" comparable as line arrays.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface UnifiedBuild {
  text: string;
  /** False when the payload hit `LIMITS.unifiedMaxBytes` and was cut. */
  complete: boolean;
}

function buildUnified(hunks: readonly DiffHunk[]): UnifiedBuild {
  if (hunks.length === 0) return { text: "", complete: true };
  const maxBytes = LIMITS.unifiedMaxBytes;
  const header = "--- before\n+++ after";
  const parts: string[] = [];
  let bytes = utf8ByteLength(header);
  for (const hunk of hunks) {
    const out: string[] = [hunk.header];
    for (const line of hunk.lines) {
      const prefix = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
      out.push(prefix + line.text);
    }
    const chunk = "\n" + out.join("\n");
    const chunkBytes = utf8ByteLength(chunk);
    if (bytes + chunkBytes > maxBytes) {
      return { text: header + parts.join(""), complete: false };
    }
    parts.push(chunk);
    bytes += chunkBytes;
  }
  return { text: header + parts.join(""), complete: true };
}

/** UTF-8 byte length without TextEncoder/Node APIs. */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function resolveCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function resolveTimeBudget(value: number | undefined): number {
  if (value === undefined) return LIMITS.diffTimeBudgetMs;
  if (value === Infinity) return Infinity;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function resolveNow(value: (() => number) | undefined): () => number {
  if (value !== undefined) return value;
  return () => Date.now();
}
