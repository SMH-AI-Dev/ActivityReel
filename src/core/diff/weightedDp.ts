import type { AlignContext, AlignResult, EditStep } from "./types";

/** Steps between deadline checks; keeps `now()` out of the hot inner loop. */
const CHECK_EVERY = 1024;

/** Squared-cell budget for the traceback matrix (Uint8: 0 diag / 1 up / 2 left). */
const MAX_TRACE_CELLS = 1_500_000;

/** Upper bound on cells the caller is expected to guard already (180k); kept as a hard stop. */
const MAX_SCORE_CELLS = 180_000;

/** A line's weight is capped so one pathological line cannot dominate the alignment. */
const MAX_LINE_WEIGHT = 100;

/**
 * Tiny per-step alignment bonus (smaller than any line weight difference that matters).
 * It makes a "replace" (delete + insert) strictly preferable to trimming that same
 * non-matching line as a common prefix/suffix line, so the spec-mandated 1:1 replace for
 * EOL-only / trailing-newline changes is the optimal alignment rather than a tie.
 */
const ALIGN_BONUS = 1e-6;

/** Tolerance for comparing accumulated floating-point scores during traceback. */
const EPS = 1e-9;

/**
 * Length-weighted LCS dynamic programming (mirrors VS Code's small-input heuristic):
 * a match scores `1 + ln(1 + lineLength)` (capped), gaps score 0, substitutions are not
 * allowed. Produces the highest-scoring legal alignment, preferring matches of longer
 * lines; equal scores prefer progress (diagonal, then up, then left).
 *
 * Returns `steps: null` when a guard (time, cells, trace memory) trips so the caller can
 * fall back to a coarse block replace.
 */
export function weightedDp(ctx: AlignContext): AlignResult {
  const oldLines = ctx.oldMiddle;
  const newLines = ctx.newMiddle;
  const n = oldLines.length;
  const m = newLines.length;
  const cols = m + 1;

  if (n === 0 && m === 0) return { steps: [], algorithm: "dp" };
  if (ctx.now() >= ctx.deadline || isAborted(ctx)) return { steps: null, algorithm: "dp" };
  if ((n + 1) * (m + 1) > MAX_SCORE_CELLS) return { steps: null, algorithm: "dp" };
  if (n === 0 || m === 0) return { steps: n === 0 ? allAdds(m) : allRemoves(n), algorithm: "dp" };

  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = Math.min(MAX_LINE_WEIGHT, 1 + Math.log1p(oldLines[i].length));

  const score = new Float64Array((n + 1) * cols);
  let stepsSinceCheck = 0;

  for (let i = 1; i <= n; i++) {
    const row = i * cols;
    const prevRow = row - cols;
    const wi = w[i - 1];
    const lineA = oldLines[i - 1];
    for (let j = 1; j <= m; j++) {
      const up = score[prevRow + j];
      const left = score[row + j - 1];
      const match = lineA === newLines[j - 1];
      const diag = match ? score[prevRow + j - 1] + wi : 0;
      const best = diag >= up && diag >= left ? diag : up >= left ? up : left;
      score[row + j] = match ? best + ALIGN_BONUS : best;
    }
    stepsSinceCheck += m;
    if (stepsSinceCheck >= CHECK_EVERY) {
      stepsSinceCheck = 0;
      if (ctx.now() >= ctx.deadline || isAborted(ctx)) return { steps: null, algorithm: "dp" };
    }
  }

  const traceCells = (n + 1) * cols;
  if (traceCells > MAX_TRACE_CELLS) return { steps: null, algorithm: "dp" };

  const trace = new Uint8Array(traceCells);
  for (let i = 1; i <= n; i++) {
    const row = i * cols;
    const prevRow = row - cols;
    const wi = w[i - 1];
    const lineA = oldLines[i - 1];
    for (let j = 1; j <= m; j++) {
      // Tie rules (deterministic): diagonal, else up (all remaining old lines removed),
      // else left. Walking back from (n, m) this emits removals only once no old line is
      // left to match, so a change block never starts with an insertion of a line that is
      // followed by removal of an earlier old line.
      const best = score[row + j];
      const diag = score[prevRow + j - 1] + wi + ALIGN_BONUS;
      if (lineA === newLines[j - 1] && Math.abs(best - diag) <= EPS) {
        trace[row + j] = 0;
      } else if (Math.abs(best - score[prevRow + j]) <= EPS) {
        trace[row + j] = 1;
      } else {
        trace[row + j] = 2;
      }
    }
  }

  const reversed: EditStep[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && trace[i * cols + j] === 0) {
      reversed.push({ kind: "equal", a: i - 1, b: j - 1 });
      i--;
      j--;
    } else if (i > 0 && (j === 0 || trace[i * cols + j] !== 2)) {
      reversed.push({ kind: "remove", a: i - 1, b: -1 });
      i--;
    } else {
      reversed.push({ kind: "add", a: -1, b: j - 1 });
      j--;
    }
  }

  reversed.reverse();
  return { steps: groupChanges(reversed), algorithm: "dp" };
}

export function allAdds(m: number): EditStep[] {
  const steps: EditStep[] = [];
  for (let j = 0; j < m; j++) steps.push({ kind: "add", a: -1, b: j });
  return steps;
}

export function allRemoves(n: number): EditStep[] {
  const steps: EditStep[] = [];
  for (let i = 0; i < n; i++) steps.push({ kind: "remove", a: i, b: -1 });
  return steps;
}

/**
 * Collapse adjacent non-equal steps into one `remove` block followed by one `add` block,
 * so consumers always see `removed* then added*` groups (renders as a clean replace).
 */
export function groupChanges(steps: readonly EditStep[]): EditStep[] {
  const out: EditStep[] = [];
  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    if (step.kind === "equal") {
      out.push(step);
      i++;
      continue;
    }
    const removes: EditStep[] = [];
    const adds: EditStep[] = [];
    while (i < steps.length && steps[i].kind !== "equal") {
      if (steps[i].kind === "remove") removes.push(steps[i]);
      else adds.push(steps[i]);
      i++;
    }
    emitBlock(removes, adds, out);
  }
  return out;
}

/**
 * Lays out one change block as all removals (ascending old index) followed by all
 * insertions (ascending new index). This keeps every hunk with a removal first, so the
 * first line of each side inside a block is the block's first line on that side; paired
 * word diffs then align `removed[i]` with `added[i]` line by line.
 */
function emitBlock(removes: readonly EditStep[], adds: readonly EditStep[], out: EditStep[]): void {
  for (const r of removes) out.push(r);
  for (const a of adds) out.push(a);
}

function isAborted(ctx: AlignContext): boolean {
  return ctx.aborted !== undefined && ctx.aborted();
}
