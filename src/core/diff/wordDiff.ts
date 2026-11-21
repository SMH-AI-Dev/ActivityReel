import type { DiffHunk, DiffLine, WordSegment } from "../../shared/model";
import { LIMITS } from "../../shared/constants";

export interface WordDiffOptions {
  /** Lines longer than this (in UTF-16 code units) are skipped. Default 3000. */
  maxLineChars?: number;
  /** Maximum removed/added pairs processed across all hunks. Default 200. */
  maxPairs?: number;
  /** Maximum tokens per line; longer lines are skipped. Default 400. */
  maxTokens?: number;
}

const DEFAULT_MAX_LINE_CHARS = LIMITS.wordDiffMaxLineChars;
const DEFAULT_MAX_PAIRS = LIMITS.wordDiffMaxPairs;
const DEFAULT_MAX_TOKENS = LIMITS.wordDiffMaxTokens;

/** LCS cell budget per line pair (tokensA+1)*(tokensB+1). */
const MAX_TOKEN_CELLS = 160_000;

interface WordDiffLimits {
  maxLineChars: number;
  maxPairs: number;
  maxTokens: number;
}

/**
 * Attach token-level word segments to paired removed/added lines inside hunks.
 *
 * Within every contiguous removed/added group, lines are paired by index
 * (`min(counts)` pairs). For each pair a Unicode-aware token LCS (runs of whitespace vs
 * runs of non-whitespace, iterating by code point) marks removed/added tokens. The
 * concatenation of a line's segments always equals the original line text exactly.
 *
 * The input hunks are not mutated: new hunk and line objects are returned.
 */
export function attachWordDiff(hunks: DiffHunk[], options?: WordDiffOptions): DiffHunk[] {
  const limits = resolveLimits(options);
  const state: { pairs: number } = { pairs: 0 };
  return hunks.map((hunk) => ({
    ...hunk,
    lines: attachToHunk(hunk.lines, limits, state),
  }));
}

function attachToHunk(
  lines: readonly DiffLine[],
  limits: WordDiffLimits,
  state: { pairs: number },
): DiffLine[] {
  if (limits.maxPairs <= 0 || limits.maxLineChars <= 0 || limits.maxTokens <= 0) {
    return lines.slice();
  }
  const out: DiffLine[] = lines.slice();
  let i = 0;
  while (i < out.length) {
    if (out[i].kind === "context") {
      i++;
      continue;
    }
    let removedStart = -1;
    let removedEnd = -1;
    let addedStart = -1;
    let addedEnd = -1;
    let j = i;
    while (j < out.length && out[j].kind !== "context") {
      if (out[j].kind === "removed") {
        if (removedStart < 0) removedStart = j;
        removedEnd = j + 1;
      } else if (out[j].kind === "added") {
        if (addedStart < 0) addedStart = j;
        addedEnd = j + 1;
      }
      j++;
    }
    if (removedStart >= 0 && addedStart >= 0) {
      const removedCount = removedEnd - removedStart;
      const addedCount = addedEnd - addedStart;
      const pairs = Math.min(removedCount, addedCount, limits.maxPairs - state.pairs);
      for (let p = 0; p < pairs; p++) {
        const oldLine = out[removedStart + p];
        const newLine = out[addedStart + p];
        const pair = diffLineTokens(oldLine.text, newLine.text, limits);
        if (pair === null) continue;
        out[removedStart + p] = { ...oldLine, words: pair.oldWords };
        out[addedStart + p] = { ...newLine, words: pair.newWords };
        state.pairs++;
      }
    }
    i = j;
  }
  return out;
}

interface TokenPairResult {
  oldWords: WordSegment[];
  newWords: WordSegment[];
}

/** Tokenize a line into alternating whitespace / non-whitespace runs (code-point safe). */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const len = text.length;
  let i = 0;
  while (i < len) {
    const isSpace = isWhitespaceCode(text.charCodeAt(i));
    const tokenStart = i;
    while (i < len) {
      const cp = text.codePointAt(i) ?? 0;
      if (isWhitespaceCode(cp) !== isSpace) break;
      i += codePointLength(text, i);
    }
    tokens.push(text.slice(tokenStart, i));
  }
  return tokens;
}

function diffLineTokens(oldText: string, newText: string, limits: WordDiffLimits): TokenPairResult | null {
  if (oldText.length > limits.maxLineChars || newText.length > limits.maxLineChars) return null;
  if (oldText === newText) {
    return {
      oldWords: oldText.length > 0 ? [{ text: oldText, changed: false }] : [],
      newWords: newText.length > 0 ? [{ text: newText, changed: false }] : [],
    };
  }
  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (a.length > limits.maxTokens || b.length > limits.maxTokens) return null;
  if ((a.length + 1) * (b.length + 1) > MAX_TOKEN_CELLS) return null;

  const keepA = lcsMask(a, b);
  const keepB = lcsMask(b, a);
  return {
    oldWords: mergeSegments(a, keepA),
    newWords: mergeSegments(b, keepB),
  };
}

/**
 * Boolean mask over `xs` marking tokens that belong to a longest common subsequence
 * with `ys`. Classic O(|xs|*|ys|) LCS with a bitmask backtrack.
 */
function lcsMask(xs: readonly string[], ys: readonly string[]): boolean[] {
  const n = xs.length;
  const m = ys.length;
  const keep = new Array<boolean>(n).fill(false);
  if (n === 0 || m === 0) return keep;

  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = 1; i <= n; i++) {
    const row = i * width;
    const prev = row - width;
    const x = xs[i - 1];
    for (let j = 1; j <= m; j++) {
      if (x === ys[j - 1]) {
        table[row + j] = table[prev + j - 1] + 1;
      } else {
        const up = table[prev + j];
        const left = table[row + j - 1];
        table[row + j] = up >= left ? up : left;
      }
    }
  }

  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (xs[i - 1] === ys[j - 1]) {
      keep[i - 1] = true;
      i--;
      j--;
    } else if (table[(i - 1) * width + j] >= table[i * width + j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return keep;
}

/** Merge adjacent tokens into runs with the same changed flag; `changed = !keep`. */
function mergeSegments(tokens: readonly string[], keep: readonly boolean[]): WordSegment[] {
  const segments: WordSegment[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const changed = !keep[i];
    const last = segments.length > 0 ? segments[segments.length - 1] : undefined;
    if (last !== undefined && last.changed === changed) {
      segments[segments.length - 1] = { text: last.text + tokens[i], changed };
    } else {
      segments.push({ text: tokens[i], changed });
    }
  }
  return segments;
}

/** Length in UTF-16 code units of the code point starting at `i` (1 or 2). */
function codePointLength(text: string, i: number): number {
  const code = text.charCodeAt(i);
  if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
    const next = text.charCodeAt(i + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return 2;
  }
  return 1;
}

const WS_RE = /^\s$/u;

function isWhitespaceCode(code: number): boolean {
  if (code < 128) return code === 32 || (code >= 9 && code <= 13);
  const ch = String.fromCodePoint(code);
  return WS_RE.test(ch);
}

function resolveLimits(options?: WordDiffOptions): WordDiffLimits {
  return {
    maxLineChars: positiveInt(options?.maxLineChars, DEFAULT_MAX_LINE_CHARS),
    maxPairs: nonNegativeInt(options?.maxPairs, DEFAULT_MAX_PAIRS),
    maxTokens: positiveInt(options?.maxTokens, DEFAULT_MAX_TOKENS),
  };
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function nonNegativeInt(value: number | undefined, fallback: number): number {
  return positiveInt(value, fallback);
}
