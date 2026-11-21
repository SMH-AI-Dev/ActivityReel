import { describe, expect, it } from "vitest";
import { attachWordDiff, tokenize } from "../../src/core/diff/wordDiff";
import { diffText } from "../../src/core/diff/diffEngine";
import type { DiffHunk, DiffLine } from "../../src/shared/model";

function hunk(lines: DiffLine[]): DiffHunk {
  return {
    header: "@@ -1,1 +1,1 @@",
    oldStart: 1,
    oldLines: lines.filter((l) => l.kind !== "added").length,
    newStart: 1,
    newLines: lines.filter((l) => l.kind !== "removed").length,
    lines,
  };
}

function joined(line: DiffLine | undefined): string {
  return (line?.words ?? []).map((w) => w.text).join("");
}

function changedText(line: DiffLine | undefined): string {
  return (line?.words ?? []).filter((w) => w.changed).map((w) => w.text).join("");
}

describe("tokenize", () => {
  it("splits into alternating whitespace and non-whitespace runs", () => {
    expect(tokenize("a b\tc")).toEqual(["a", " ", "b", "\t", "c"]);
    expect(tokenize("  lead")).toEqual(["  ", "lead"]);
    expect(tokenize("")).toEqual([]);
  });

  it("keeps surrogate pairs intact", () => {
    expect(tokenize("😀 😀x")).toEqual(["😀", " ", "😀x"]);
    expect(tokenize("🎉🎉")).toEqual(["🎉🎉"]);
  });

  it("treats Persian words as single tokens", () => {
    expect(tokenize("سلام دنیا")).toEqual(["سلام", " ", "دنیا"]);
  });
});

describe("attachWordDiff", () => {
  it("marks changed tokens on paired lines and concatenates exactly", () => {
    const result = attachWordDiff([
      hunk([
        { kind: "removed", text: "const a = 1;", oldLine: 1 },
        { kind: "added", text: "const a = 2;", newLine: 1 },
      ]),
    ]);
    const [removed, added] = result[0].lines;
    expect(joined(removed)).toBe("const a = 1;");
    expect(joined(added)).toBe("const a = 2;");
    // "1" and ";" merge into one changed run.
    expect(changedText(removed)).toBe("1;");
    expect(changedText(added)).toBe("2;");
    expect(removed.words).toEqual([
      { text: "const a = ", changed: false },
      { text: "1;", changed: true },
    ]);
    expect(added.words).toEqual([
      { text: "const a = ", changed: false },
      { text: "2;", changed: true },
    ]);
  });

  it("only marks changed tokens in deletes (removed) and inserts (added)", () => {
    const result = attachWordDiff([
      hunk([
        { kind: "removed", text: "hello world", oldLine: 1 },
        { kind: "added", text: "hello there", newLine: 1 },
      ]),
    ]);
    const [removed, added] = result[0].lines;
    expect(removed.words?.every((w) => (w.changed ? w.text.trim().length > 0 : true))).toBe(true);
    expect(changedText(removed)).toBe("world");
    expect(changedText(added)).toBe("there");
  });

  it("pairs groups by index and leaves unpaired lines without words", () => {
    const result = attachWordDiff([
      hunk([
        { kind: "removed", text: "a one", oldLine: 1 },
        { kind: "removed", text: "a two", oldLine: 2 },
        { kind: "added", text: "b one", newLine: 1 },
        { kind: "context", text: "gap", oldLine: 3, newLine: 2 },
      ]),
    ]);
    const lines = result[0].lines;
    expect(joined(lines[0])).toBe("a one");
    expect(lines[1].words).toBeUndefined();
    expect(joined(lines[2])).toBe("b one");
    expect(lines[3].words).toBeUndefined();
  });

  it("does not attach words to context lines", () => {
    const result = attachWordDiff([
      hunk([
        { kind: "context", text: "unchanged", oldLine: 1, newLine: 1 },
        { kind: "removed", text: "x y", oldLine: 2 },
        { kind: "added", text: "x z", newLine: 2 },
      ]),
    ]);
    expect(result[0].lines[0].words).toBeUndefined();
  });

  it("does not mutate the input hunks", () => {
    const original = hunk([
      { kind: "removed", text: "one two", oldLine: 1 },
      { kind: "added", text: "one three", newLine: 1 },
    ]);
    const snapshot = JSON.parse(JSON.stringify(original)) as DiffHunk;
    const result = attachWordDiff([original]);
    expect(original).toEqual(snapshot);
    expect(result[0]).not.toBe(original);
    expect(result[0].lines[0].words).toBeDefined();
  });

  it("handles Persian RTL and emoji/surrogate pairs exactly", () => {
    const remText = "سلام 👋 دنیا 😀😀 پایان";
    const addText = "سلام ✋ دنیا 😀 پایان";
    const result = attachWordDiff([
      hunk([
        { kind: "removed", text: remText, oldLine: 1 },
        { kind: "added", text: addText, newLine: 1 },
      ]),
    ]);
    const [removed, added] = result[0].lines;
    expect(joined(removed)).toBe(remText);
    expect(joined(added)).toBe(addText);
    // 😀😀 is one token: vs a single 😀 the run is replaced, not split at the pair boundary.
    expect(changedText(removed)).toBe("👋😀😀");
    expect(changedText(added)).toBe("✋😀");
  });

  it("emits a single unchanged segment for identical paired lines", () => {
    const result = attachWordDiff([
      hunk([
        { kind: "removed", text: "same", oldLine: 1 },
        { kind: "added", text: "same", newLine: 1 },
      ]),
    ]);
    expect(result[0].lines[0].words).toEqual([{ text: "same", changed: false }]);
  });

  it("reports whitespace-only differences on the whitespace tokens", () => {
    const result = attachWordDiff([
      hunk([
        { kind: "removed", text: "a  b", oldLine: 1 },
        { kind: "added", text: "a b", newLine: 1 },
      ]),
    ]);
    expect(joined(result[0].lines[0])).toBe("a  b");
    expect(joined(result[0].lines[1])).toBe("a b");
    expect(changedText(result[0].lines[0])).toBe("  ");
    expect(changedText(result[0].lines[1])).toBe(" ");
  });

  it("skips long lines (minified) and token-heavy lines", () => {
    const long = "x".repeat(3001);
    const tokens = Array.from({ length: 401 }, (_, i) => `t${i}`).join(" ");
    const result = attachWordDiff([
      hunk([
        { kind: "removed", text: long, oldLine: 1 },
        { kind: "added", text: `${long}y`, newLine: 1 },
      ]),
      hunk([
        { kind: "removed", text: tokens, oldLine: 2 },
        { kind: "added", text: `${tokens} z`, newLine: 2 },
      ]),
    ]);
    expect(result[0].lines.every((l) => l.words === undefined)).toBe(true);
    expect(result[1].lines.every((l) => l.words === undefined)).toBe(true);

    const custom = attachWordDiff(
      [
        hunk([
          { kind: "removed", text: "a b c", oldLine: 1 },
          { kind: "added", text: "a b d", newLine: 1 },
        ]),
      ],
      { maxTokens: 2 },
    );
    expect(custom[0].lines.every((l) => l.words === undefined)).toBe(true);
  });

  it("respects the pair cap across all hunks", () => {
    const pairs = 5;
    const input: DiffHunk[] = [];
    for (let p = 0; p < pairs; p++) {
      input.push(
        hunk([
          { kind: "removed", text: `old ${p}`, oldLine: p + 1 },
          { kind: "added", text: `new ${p}`, newLine: p + 1 },
        ]),
      );
    }
    const result = attachWordDiff(input, { maxPairs: 2 });
    const withWords = result.filter((h) => h.lines.some((l) => l.words !== undefined));
    expect(withWords).toHaveLength(2);
    expect(result[0].lines[0].words).toBeDefined();
    expect(result[1].lines[0].words).toBeDefined();
    expect(result[2].lines[0].words).toBeUndefined();
  });

  it("works end to end with diffText output", () => {
    const oldText = "line one\nhello brave world\nline three";
    const newText = "line one\nhello big world\nline three";
    const diff = diffText(oldText, newText);
    const decorated = attachWordDiff(diff.hunks);
    const changeLines = decorated[0].lines.filter((l) => l.kind !== "context");
    expect(changeLines).toHaveLength(2);
    expect(joined(changeLines[0])).toBe("hello brave world");
    expect(joined(changeLines[1])).toBe("hello big world");
    expect(changedText(changeLines[0])).toBe("brave");
    expect(changedText(changeLines[1])).toBe("big");
    // Original hunks are untouched.
    expect(diff.hunks[0].lines.every((l) => l.words === undefined)).toBe(true);
  });
});
