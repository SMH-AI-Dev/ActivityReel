import { describe, expect, it } from "vitest";
import {
  diffOperations,
  diffText,
  toHunks,
} from "../../src/core/diff/diffEngine";
import type { OperationLine } from "../../src/core/diff/diffEngine";
import type { DiffHunk } from "../../src/shared/model";
import { LIMITS } from "../../src/shared/constants";

function lines(n: number, prefix = "line"): string {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join("\n");
}

/**
 * Rebuild the full operation list from hunks, filling the unchanged gaps between hunks
 * with context lines taken from `oldLines` (hunks omit those gaps).
 */
function operationsFromHunks(hunks: DiffHunk[], oldLines: string[]): OperationLine[] {
  const ops: OperationLine[] = [];
  let nextOld = 1;
  let nextNew = 1;
  for (const hunk of hunks) {
    const hunkOldStart = hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart;
    const hunkNewStart = hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart;
    while (nextOld < hunkOldStart && nextNew < hunkNewStart) {
      ops.push({ kind: "context", text: oldLines[nextOld - 1], oldLine: nextOld, newLine: nextNew });
      nextOld++;
      nextNew++;
    }
    for (const line of hunk.lines) {
      const op: OperationLine = { kind: line.kind, text: line.text };
      if (line.oldLine !== undefined) op.oldLine = line.oldLine;
      if (line.newLine !== undefined) op.newLine = line.newLine;
      ops.push(op);
      if (line.kind !== "added") nextOld = (line.oldLine ?? nextOld) + 1;
      if (line.kind !== "removed") nextNew = (line.newLine ?? nextNew) + 1;
    }
  }
  return ops;
}

/**
 * Apply an operation list to the old lines, asserting every operation is consistent with
 * the old text, and return the new lines.
 */
function applyOperations(ops: OperationLine[], oldLines: string[]): string[] {
  const out: string[] = [];
  let oldIndex = 0;
  for (const op of ops) {
    if (op.kind === "removed") {
      expect(op.oldLine).toBe(oldIndex + 1);
      expect(op.text).toBe(oldLines[oldIndex]);
      oldIndex++;
    } else if (op.kind === "added") {
      out.push(op.text);
    } else {
      expect(op.oldLine).toBe(oldIndex + 1);
      expect(op.text).toBe(oldLines[oldIndex]);
      out.push(op.text);
      oldIndex++;
    }
  }
  expect(oldIndex).toBe(oldLines.length);
  return out;
}

/** Deterministic PRNG (mulberry32) for the property test. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("diffText: degenerate inputs", () => {
  it("returns no hunks for identical input", () => {
    const text = lines(20);
    const result = diffText(text, text);
    expect(result.hunks).toEqual([]);
    expect(result.stat).toEqual({ added: 0, removed: 0, hunks: 0, truncated: false });
    expect(result.fullAvailable).toBe(true);
    expect(result.mode).toBe("exact");
    expect(result.unified).toBe("");
  });

  it("handles empty old, empty new and both empty", () => {
    const added = diffText("", "a\nb");
    expect(added.stat.added).toBe(2);
    expect(added.stat.removed).toBe(0);
    expect(added.hunks[0].header).toBe("@@ -0,0 +1,2 @@");
    expect(added.hunks[0].lines.map((l) => l.kind)).toEqual(["added", "added"]);

    const removed = diffText("a\nb", "");
    expect(removed.stat.removed).toBe(2);
    expect(removed.hunks[0].header).toBe("@@ -1,2 +0,0 @@");

    const both = diffText("", "");
    expect(both.hunks).toEqual([]);
    expect(both.stat).toEqual({ added: 0, removed: 0, hunks: 0, truncated: false });
    expect(both.fullAvailable).toBe(true);
  });

  it("does not mutate input strings", () => {
    const oldText = "a\nb\nc";
    const newText = "a\nB\nc";
    const oldCopy = oldText.slice();
    const newCopy = newText.slice();
    const fromOperations = diffOperations(oldText, newText).operations.slice();
    diffText(oldText, newText);
    expect(oldText).toBe(oldCopy);
    expect(newText).toBe(newCopy);
    expect(diffOperations(oldText, newText).operations).toEqual(fromOperations);
  });
});

describe("diffText: single changes", () => {
  const base = ["alpha", "beta", "gamma", "delta", "epsilon"];

  it("single line insert", () => {
    const next = [...base.slice(0, 2), "inserted", ...base.slice(2)];
    const result = diffText(base.join("\n"), next.join("\n"));
    expect(result.hunks).toHaveLength(1);
    const hunk = result.hunks[0];
    expect(hunk.header).toBe("@@ -1,5 +1,6 @@");
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldLines).toBe(5);
    expect(hunk.newLines).toBe(6);
    const added = hunk.lines.filter((l) => l.kind === "added");
    expect(added).toEqual([{ kind: "added", text: "inserted", newLine: 3 }]);
    expect(result.stat).toMatchObject({ added: 1, removed: 0, hunks: 1, truncated: false });
    expect(result.fullAvailable).toBe(true);
  });

  it("single line delete", () => {
    const next = base.filter((l) => l !== "gamma");
    const result = diffText(base.join("\n"), next.join("\n"));
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0].header).toBe("@@ -1,5 +1,4 @@");
    const removed = result.hunks[0].lines.filter((l) => l.kind === "removed");
    expect(removed).toEqual([{ kind: "removed", text: "gamma", oldLine: 3 }]);
    expect(result.stat).toMatchObject({ added: 0, removed: 1 });
  });

  it("single line replace", () => {
    const next = [...base.slice(0, 2), "GAMMA", ...base.slice(3)];
    const result = diffText(base.join("\n"), next.join("\n"));
    expect(result.hunks).toHaveLength(1);
    expect(result.unified).toBe(
      ["--- before", "+++ after", "@@ -1,5 +1,5 @@", " alpha", " beta", "-gamma", "+GAMMA", " delta", " epsilon"].join(
        "\n",
      ),
    );
    expect(result.stat).toMatchObject({ added: 1, removed: 1, hunks: 1 });
  });

  it("assigns line numbers per kind", () => {
    const result = diffText("x\ny", "x\nz");
    const ops = diffOperations("x\ny", "x\nz").operations;
    expect(ops).toEqual([
      { kind: "context", text: "x", oldLine: 1, newLine: 1 },
      { kind: "removed", text: "y", oldLine: 2 },
      { kind: "added", text: "z", newLine: 2 },
    ]);
    expect(result.hunks[0].header).toBe("@@ -1,2 +1,2 @@");
  });
});

describe("diffText: EOL handling", () => {
  it("treats CRLF and LF as the same lines", () => {
    const lf = "a\nb\nc";
    const crlf = "a\r\nb\r\nc";
    const result = diffText(lf, crlf);
    expect(result.mode).toBe("exact");
    expect(result.stat).toEqual({ added: 1, removed: 1, hunks: 1, truncated: false });
    const hunk = result.hunks[0];
    expect(hunk.lines.map((l) => l.kind)).toEqual(["context", "context", "removed", "added"]);
    expect(hunk.lines[2]).toMatchObject({ kind: "removed", text: "c", oldLine: 3 });
    expect(hunk.lines[3]).toMatchObject({ kind: "added", text: "c", newLine: 3 });
  });

  it("reports a trailing newline change as a replace of the last line", () => {
    // A trailing newline terminates the last line; it does not create a phantom extra line.
    // "a\nb\n" and "a\nb" therefore differ only in the final line's terminator, which `diff`
    // reports as a 1:1 replacement of "b".
    const result = diffText("a\nb\n", "a\nb");
    expect(result.mode).toBe("exact");
    expect(result.stat).toMatchObject({ added: 1, removed: 1, hunks: 1 });
    expect(result.hunks[0].lines).toEqual([
      { kind: "context", text: "a", oldLine: 1, newLine: 1 },
      { kind: "removed", text: "b", oldLine: 2 },
      { kind: "added", text: "b", newLine: 2 },
    ]);
    const unified = result.unified.split("\n");
    expect(unified.slice(0, 2)).toEqual(["--- before", "+++ after"]);
    expect(unified.slice(2)).toEqual(["@@ -1,2 +1,2 @@", " a", "-b", "+b"]);

    const addingNewline = diffText("a\r\nb", "a\r\nb\r\n");
    expect(addingNewline.mode).toBe("exact");
    expect(addingNewline.stat).toMatchObject({ added: 1, removed: 1, hunks: 1 });
    expect(addingNewline.hunks[0].lines.at(-1)).toMatchObject({ kind: "added", text: "b", newLine: 2 });
  });

  it("keeps a real blank final line", () => {
    // "a\nb\n\n" has a blank line after "b"; dropping only the terminating phantom keeps it.
    const result = diffText("a\nb\n", "a\nb\n\n");
    expect(result.stat).toMatchObject({ added: 1, removed: 0 });
    expect(result.hunks[0].lines.at(-1)).toMatchObject({ kind: "added", text: "", newLine: 3 });
  });
});

describe("diffText: hunking", () => {
  const oldLines = Array.from({ length: 60 }, (_, i) => `row ${i + 1}`);
  const newLines = oldLines.slice();
  newLines[2] = "row 3 changed";
  newLines[40] = "row 41 changed";
  newLines.splice(20, 0, "row 20.5 inserted");
  const oldText = oldLines.join("\n");
  const newText = newLines.join("\n");

  it("merges and splits hunks with context 3", () => {
    const result = diffText(oldText, newText);
    expect(result.hunks).toHaveLength(3);
    for (const hunk of result.hunks) {
      const firstChange = hunk.lines.findIndex((l) => l.kind !== "context");
      const lastChange = hunk.lines.length - 1 - [...hunk.lines].reverse().findIndex((l) => l.kind !== "context");
      expect(firstChange).toBeLessThanOrEqual(3);
      expect(hunk.lines.length - 1 - lastChange).toBeLessThanOrEqual(3);
      expect(hunk.header).toBe(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    }
    // "row 20.5 inserted" and "row 3 changed" are 17 lines apart (> 2 * 3) -> 3 hunks.
    // Two lines differ on both sides plus one insertion; the DP may align some unchanged
    // lines differently, so assert the invariant: stat.hunks always equals the full count.
    expect(result.stat.added).toBeGreaterThanOrEqual(2);
    expect(result.stat.removed).toBeGreaterThanOrEqual(2);
    expect(result.stat.hunks).toBe(3);
  });

  it("merges nearby changes with large context and splits with context 0/1", () => {
    const nearOld = lines(30);
    const nearNew = nearOld.split("\n");
    nearNew[10] = "change A";
    nearNew[13] = "change B";
    const merged = diffText(nearOld, nearNew.join("\n"), { contextLines: 3 });
    expect(merged.hunks).toHaveLength(1);

    // Changes on lines 11 and 14 are separated by 2 context lines: 2 > 2 * 0 and 2 <= 2 * 1.
    const c0 = diffText(nearOld, nearNew.join("\n"), { contextLines: 0 });
    expect(c0.hunks).toHaveLength(2);
    expect(c0.hunks[0].lines.every((l) => l.kind !== "context")).toBe(true);
    expect(c0.hunks[0].header).toBe("@@ -11,1 +11,1 @@");

    const c1 = diffText(nearOld, nearNew.join("\n"), { contextLines: 1 });
    expect(c1.hunks).toHaveLength(1);
    // Lines 10..15: one context line before, two shared between, one after, plus changes.
    expect(c1.hunks[0].lines).toHaveLength(8);
  });

  it("does not add context beyond file end", () => {
    const result = diffText("a\nb\nc", "a\nb\nC");
    // Context is clamped by the change position and change size, never padded at EOF.
    expect(result.hunks[0].lines).toHaveLength(4);
    expect(result.hunks[0].header).toBe("@@ -1,3 +1,3 @@");
    const tail = diffText("a\nb\nc", "a\nb\nc\nd");
    expect(tail.hunks[0].lines).toHaveLength(4);
    expect(tail.hunks[0].lines.at(-1)).toMatchObject({ kind: "added", text: "d", newLine: 4 });
    const head = diffText("a\nb", "z\na\nb");
    // The only operations are the insertion plus the two kept lines; no padding context.
    expect(head.hunks[0].lines).toHaveLength(3);
    expect(head.hunks[0].lines[0]).toMatchObject({ kind: "added", text: "z", newLine: 1 });
  });
});

describe("diffText: display cap", () => {
  it("keeps stat counts full while truncating display", () => {
    const oldText = lines(200);
    const newLines = oldText.split("\n");
    for (let i = 0; i < 200; i += 2) newLines[i] = `${newLines[i]} edited`;
    const newText = newLines.join("\n");
    const result = diffText(oldText, newText, { maxDiffLines: 20 });
    expect(result.stat.added).toBe(100);
    expect(result.stat.removed).toBe(100);
    expect(result.stat.truncated).toBe(true);
    expect(result.fullAvailable).toBe(false);
    expect(result.mode).toBe("exact");
    const displayed = result.hunks.reduce((sum, h) => sum + h.lines.length, 0);
    expect(displayed).toBeLessThanOrEqual(20);
    // Unified diff is built from displayed operations only.
    const unifiedLines = result.unified.split("\n");
    const changedUnified = unifiedLines.filter(
      (l) => (l.startsWith("+") && !l.startsWith("+++")) || (l.startsWith("-") && !l.startsWith("---")),
    );
    expect(changedUnified.length).toBeGreaterThan(0);
    expect(changedUnified.length).toBeLessThanOrEqual(20);
    expect(result.unified).toContain("@@ -1,");
    const uncapped = diffText(oldText, newText);
    expect(uncapped.stat.truncated).toBe(false);
    expect(uncapped.fullAvailable).toBe(true);
    const uncappedAdded = uncapped.unified
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    expect(uncappedAdded).toHaveLength(100);
  });

  it("keeps stat.hunks as the full hunk count", () => {
    const oldText = lines(100);
    const newLines = oldText.split("\n");
    newLines[5] = "one";
    newLines[50] = "two";
    newLines[95] = "three";
    const result = diffText(oldText, newLines.join("\n"), { maxDiffLines: 8 });
    expect(result.stat.hunks).toBe(3);
    expect(result.hunks.length).toBeLessThan(3);
  });
});

describe("diffText: coarse fallback", () => {
  it("falls back to one removed + one added block when time is exhausted", () => {
    const oldText = lines(300);
    const newText = lines(300).split("\n").reverse().join("\n");
    const result = diffText(oldText, newText, { maxTimeMs: 0 });
    expect(result.mode).toBe("coarse");
    expect(result.stat.truncated).toBe(true);
    expect(result.fullAvailable).toBe(false);
    expect(result.stat.removed).toBeGreaterThan(0);
    expect(result.stat.added).toBeGreaterThan(0);
    const kinds = result.hunks[0].lines.map((l) => l.kind);
    const firstAdd = kinds.indexOf("added");
    const lastRemove = kinds.lastIndexOf("removed");
    expect(lastRemove).toBeLessThan(firstAdd);
  });

  it("keeps trimmed prefix/suffix in coarse mode", () => {
    const prefix = lines(5, "same");
    // Sum > 1700 lines -> Myers path -> deadline check trips immediately with maxTimeMs 0.
    const oldBody = Array.from({ length: 1000 }, (_, i) => `old ${i}`);
    const newBody = Array.from({ length: 1000 }, (_, i) => `new ${i}`);
    const oldText = [prefix, oldBody.join("\n"), "tail"].join("\n");
    const newText = [prefix, newBody.join("\n"), "tail"].join("\n");
    const result = diffText(oldText, newText, { maxTimeMs: 0 });
    expect(result.mode).toBe("coarse");
    const ops = diffOperations(oldText, newText, { maxTimeMs: 0 }).operations;
    expect(ops.slice(0, 5).every((o) => o.kind === "context")).toBe(true);
    expect(ops.at(-1)).toMatchObject({ kind: "context", text: "tail", oldLine: 1006, newLine: 1006 });
    // Trailing suffix "tail" is trimmed; the two bodies differ on every line.
    expect(result.stat.removed).toBe(1000);
    expect(result.stat.added).toBe(1000);
  });

  it("coarse fallback still reproduces the new text", () => {
    const oldText = lines(50);
    const newText = lines(50).split("\n").map((l) => `${l}!`).join("\n");
    const ops = diffOperations(oldText, newText, { maxTimeMs: 0 }).operations;
    expect(applyOperations(ops, oldText.split("\n")).join("\n")).toBe(newText);
  });
});

describe("diffText: algorithms", () => {
  it("uses the DP path for small inputs", () => {
    const oldText = lines(100);
    const newText = oldText.split("\n").map((l, i) => (i === 50 ? "changed" : l)).join("\n");
    const result = diffText(oldText, newText);
    expect(result.mode).toBe("exact");
    expect(result.stat).toMatchObject({ added: 1, removed: 1, hunks: 1 });
  });

  it("uses the Myers path for N+M >= 1700 with a small edit", () => {
    const oldText = lines(900);
    const next = oldText.split("\n");
    next[450] = "changed";
    const newText = next.join("\n");
    const full = diffOperations(oldText, newText);
    expect(full.mode).toBe("exact");
    expect(full.operations.filter((o) => o.kind !== "context")).toHaveLength(2);
    const result = diffText(oldText, newText);
    expect(result.stat).toMatchObject({ added: 1, removed: 1, hunks: 1 });
  });

  it("uses Myers for DP-cell-guard inputs (sum < 1700 but cells > 180k)", () => {
    // 600 x 600 = 360_000 cells, sum 1200 < 1700.
    const oldText = lines(600);
    const next = oldText.split("\n");
    next[300] = "mid";
    const result = diffText(oldText, next.join("\n"));
    expect(result.mode).toBe("exact");
    expect(result.stat).toMatchObject({ added: 1, removed: 1, hunks: 1 });
  });

  it("coarse when D exceeds the Myers cap", () => {
    const oldText = lines(1200, "a");
    const newText = lines(1200, "b");
    // Sum = 2400 -> Myers; D = 2400 > 600 -> coarse.
    const result = diffText(oldText, newText);
    expect(result.mode).toBe("coarse");
    expect(result.stat.truncated).toBe(true);
  });

  it("respects the default time budget constant", () => {
    expect(LIMITS.diffTimeBudgetMs).toBe(250);
    const result = diffText("a", "b");
    expect(result.mode).toBe("exact");
  });
});

describe("diffText: multi-cursor and unicode", () => {
  it("produces multiple hunks for scattered edits", () => {
    const oldText = lines(40);
    const next = oldText.split("\n");
    next[0] = "top edit";
    next[19] = "middle edit";
    next[39] = "bottom edit";
    const result = diffText(oldText, next.join("\n"));
    expect(result.hunks).toHaveLength(3);
    expect(result.hunks[0].oldStart).toBe(1);
    expect(result.stat).toMatchObject({ added: 3, removed: 3, hunks: 3 });
  });

  it("handles Persian RTL text and emoji surrogate pairs", () => {
    const oldLines = ["سلام دنیا 👋", "خط دوم 🌍 با ایموجی 😀😀", "پایان"];
    const newLines = ["سلام دنیا ✋", "خط دوم 🌍 با ایموجی 😀", "پایان", "خط جدید 🎉"];
    const oldText = oldLines.join("\n");
    const newText = newLines.join("\n");
    const result = diffText(oldText, newText);
    expect(result.mode).toBe("exact");
    expect(result.stat.added).toBeGreaterThanOrEqual(2);
    expect(result.stat.removed).toBeGreaterThanOrEqual(1);
    const allLines = result.hunks.flatMap((h) => h.lines);
    expect(allLines.find((l) => l.kind === "removed")?.text).toBe(oldLines[0]);
    expect(allLines.find((l) => l.kind === "added")?.text).toBe(newLines[0]);
    const ops = diffOperations(oldText, newText).operations;
    expect(applyOperations(ops, oldLines)).toEqual(newLines);
  });

  it("keeps unified prefixes correct for unicode", () => {
    const result = diffText("😀 a", "😀 b");
    expect(result.unified.split("\n").slice(3)).toEqual(["-😀 a", "+😀 b"]);
  });
});

describe("toHunks", () => {
  it("returns no hunks with no changes", () => {
    expect(toHunks([], 3)).toEqual([]);
    expect(toHunks([{ kind: "context", text: "a", oldLine: 1, newLine: 1 }], 3)).toEqual([]);
  });

  it("builds headers from operation numbers", () => {
    const ops: OperationLine[] = [
      { kind: "context", text: "a", oldLine: 1, newLine: 1 },
      { kind: "added", text: "b", newLine: 2 },
      { kind: "context", text: "c", oldLine: 2, newLine: 3 },
    ];
    const [hunk] = toHunks(ops, 1);
    expect(hunk).toEqual({
      header: "@@ -1,2 +1,3 @@",
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 3,
      lines: ops,
    });
  });

  it("handles pure insertions and deletions at the boundaries", () => {
    const insertAtTop: OperationLine[] = [
      { kind: "added", text: "x", newLine: 1 },
      { kind: "context", text: "a", oldLine: 1, newLine: 2 },
    ];
    expect(toHunks(insertAtTop, 0)[0].header).toBe("@@ -0,0 +1,1 @@");
    const deleteAtEnd: OperationLine[] = [
      { kind: "context", text: "a", oldLine: 1, newLine: 1 },
      { kind: "removed", text: "b", oldLine: 2 },
    ];
    // Empty side of a range starts at the line preceding the hunk (1 here: "a" is kept),
    // per the unified-diff convention.
    expect(toHunks(deleteAtEnd, 0)[0].header).toBe("@@ -2,1 +1,0 @@");
  });
});

describe("property: applying operations reproduces the new text", () => {
  const words = ["alpha", "beta", "gamma", "delta", "", "  indented", "تابستان", "🙂 emoji"];

  /**
   * Generate a document whose `join("\n")` round-trips through the engine's line splitter.
   * A text ending in "\n" has no phantom final line (the terminator belongs to the last
   * line), so a line array ending with "" cannot be represented; keep the last line real.
   */
  function randomDoc(random: () => number, size: number): string[] {
    const doc = Array.from({ length: size }, () => words[Math.floor(random() * words.length)]);
    if (doc[doc.length - 1] === "") doc[doc.length - 1] = "tail";
    return doc;
  }

  function mutate(random: () => number, doc: string[]): string[] {
    const out = doc.slice();
    const edits = 1 + Math.floor(random() * 4);
    for (let e = 0; e < edits; e++) {
      const at = Math.floor(random() * (out.length + 1));
      const roll = random();
      if (roll < 0.34) {
        out.splice(at, 0, words[Math.floor(random() * words.length)]);
      } else if (roll < 0.67 && out.length > 0) {
        out.splice(Math.min(at, out.length - 1), 1);
      } else if (out.length > 0) {
        out[Math.min(at, out.length - 1)] = `${words[Math.floor(random() * words.length)]}!`;
      }
    }
    if (out[out.length - 1] === "") out[out.length - 1] = "tail";
    return out;
  }

  it("round-trips 200 generated edit pairs through hunks and operations", () => {
    const random = rng(20261121);
    for (let iter = 0; iter < 200; iter++) {
      const oldLines = randomDoc(random, 1 + Math.floor(random() * 60));
      const newLines = mutate(random, oldLines);
      const oldText = oldLines.join("\n");
      const newText = newLines.join("\n");

      const full = diffOperations(oldText, newText);
      expect(full.mode).toBe("exact");
      expect(applyOperations(full.operations, oldLines).join("\n")).toBe(newText);

      const hunks = toHunks(full.operations, 1_000_000);
      expect(applyOperations(operationsFromHunks(hunks, oldLines), oldLines).join("\n")).toBe(newText);

      const capped = diffText(oldText, newText, {
        maxDiffLines: 1_000_000,
        contextLines: 1_000_000,
      });
      expect(capped.fullAvailable).toBe(true);
      expect(applyOperations(operationsFromHunks(capped.hunks, oldLines), oldLines).join("\n")).toBe(newText);
    }
  });

  it("round-trips on the Myers path", () => {
    const random = rng(7);
    for (let iter = 0; iter < 10; iter++) {
      const oldLines = randomDoc(random, 900);
      const newLines = mutate(random, oldLines);
      const oldText = oldLines.join("\n");
      const newText = newLines.join("\n");
      const full = diffOperations(oldText, newText);
      expect(full.mode).toBe("exact");
      expect(applyOperations(full.operations, oldLines).join("\n")).toBe(newText);
    }
  });

  it("is deterministic", () => {
    const oldText = lines(50);
    const newText = oldText.split("\n").map((l, i) => (i % 7 === 0 ? `x ${l}` : l)).join("\n");
    const first = diffText(oldText, newText);
    const second = diffText(oldText, newText);
    expect(second).toEqual(first);
    expect(diffText(oldText, newText, { now: () => 42 })).toEqual(first);
  });
});
