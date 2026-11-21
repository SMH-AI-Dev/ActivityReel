import type { DiffHunk, DiffLine } from "../../shared/model";
import type { OperationLine } from "./types";

/**
 * Group a full operation list into unified-diff hunks.
 *
 * - Each change block (a maximal run of `removed`/`added` operations) is surrounded by at
 *   most `contextLines` unchanged lines on each side, clamped to the file boundaries.
 * - Blocks whose context windows touch or overlap (distance <= 2 * contextLines) merge.
 * - `oldStart`/`newStart` follow unified-diff convention: the first line number of the
 *   range, or 1 less than the next line when the range is empty (`,0`), so that
 *   `@@ -a,b +c,d @@` stays parseable by standard tools.
 */
export function toHunks(operations: OperationLine[], contextLines: number): DiffHunk[] {
  const ctx = normalizeContext(contextLines);
  const n = operations.length;
  if (n === 0) return [];

  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < n) {
    if (operations[i].kind === "context") {
      i++;
      continue;
    }
    // Start of a change block.
    const blockStart = i;
    let blockEnd = i;
    while (blockEnd < n && operations[blockEnd].kind !== "context") blockEnd++;

    const start = Math.max(0, blockStart - ctx);
    let end = Math.min(n, blockEnd + ctx);
    // Merge subsequent blocks whose leading context touches this hunk.
    let cursor = blockEnd;
    while (cursor < n) {
      let next = cursor;
      while (next < n && operations[next].kind === "context") next++;
      if (next >= n) break;
      if (next - cursor > 2 * ctx) break;
      let nextEnd = next;
      while (nextEnd < n && operations[nextEnd].kind !== "context") nextEnd++;
      end = Math.min(n, nextEnd + ctx);
      cursor = nextEnd;
    }

    hunks.push(buildHunk(operations, start, end));
    i = end;
  }

  return hunks;
}

function buildHunk(operations: readonly OperationLine[], start: number, end: number): DiffHunk {
  const lines: DiffLine[] = [];
  let oldLines = 0;
  let newLines = 0;

  for (let i = start; i < end; i++) {
    const op = operations[i];
    const line: DiffLine = { kind: op.kind, text: op.text };
    if (op.oldLine !== undefined) line.oldLine = op.oldLine;
    if (op.newLine !== undefined) line.newLine = op.newLine;
    lines.push(line);
    if (op.kind !== "added") oldLines++;
    if (op.kind !== "removed") newLines++;
  }

  // Block layout is "removals, then insertions" for every change, so the first operation
  // that touches a side is that side's first line. When a side has no line in the hunk,
  // unified-diff convention uses the line preceding the hunk (0 at file start).
  const firstOld = lines.find((l) => l.kind !== "added");
  const firstNew = lines.find((l) => l.kind !== "removed");
  const oldStart = oldLines === 0 ? Math.max(0, cursorBefore(operations, start, "oldLine")) : (firstOld?.oldLine ?? 1);
  const newStart = newLines === 0 ? Math.max(0, cursorBefore(operations, start, "newLine")) : (firstNew?.newLine ?? 1);

  return {
    header: formatHeader(oldStart, oldLines, newStart, newLines),
    oldStart,
    oldLines,
    newStart,
    newLines,
    lines,
  };
}

export /** Last line number seen on one side strictly before `index` (0 when none). */
function cursorBefore(
  operations: readonly OperationLine[],
  index: number,
  key: "oldLine" | "newLine",
): number {
  for (let i = index - 1; i >= 0; i--) {
    const value = operations[i][key];
    if (value !== undefined) return value;
  }
  return 0;
}

function formatHeader(
  oldStart: number,
  oldLines: number,
  newStart: number,
  newLines: number,
): string {
  return `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;
}

function normalizeContext(contextLines: number): number {
  if (!Number.isFinite(contextLines)) return 0;
  return Math.max(0, Math.min(1000, Math.floor(contextLines)));
}
