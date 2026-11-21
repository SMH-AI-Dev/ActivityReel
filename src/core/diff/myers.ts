import type { AlignContext, AlignResult, EditStep } from "./types";
import { groupChanges } from "./weightedDp";

/** Steps between deadline checks. */
const CHECK_EVERY = 1024;

/**
 * Myers O(ND) with an edit-distance cap.
 *
 * Trace memory is bounded by the cap, not by the input: the trace buffer is
 * `cap * (2 * cap + 3)` Int32s (~1.45 MB at the default cap of 600) and each depth only
 * snapshots one row of the V array. Returns `steps: null` when `d > cap` or the deadline
 * passes so the caller can fall back to a coarse replace.
 */
export function myers(ctx: AlignContext, maxD: number): AlignResult {
  const a = ctx.oldMiddle;
  const b = ctx.newMiddle;
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return { steps: [], algorithm: "myers" };
  if (ctx.now() >= ctx.deadline || isAborted(ctx)) return { steps: null, algorithm: "myers" };
  if (n === 0) return { steps: adds(m), algorithm: "myers" };
  if (m === 0) return { steps: removes(n), algorithm: "myers" };

  const cap = Math.max(0, Math.min(maxD, n + m));
  if (Math.abs(n - m) > cap) return { steps: null, algorithm: "myers" };

  const width = 2 * cap + 3;
  const offset = cap + 1;
  const trace = new Int32Array((cap + 1) * width);
  const v = new Int32Array(width);
  v[offset + 1] = 0;

  let found = -1;
  let budget = CHECK_EVERY;

  for (let d = 0; d <= cap && found < 0; d++) {
    const rowBase = d * width;
    for (let k = -d; k <= d; k += 2) {
      const idx = offset + k;
      let x: number;
      if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) x = v[idx + 1];
      else x = v[idx - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[idx] = x;
      trace[rowBase + idx] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
      if (--budget <= 0) {
        budget = CHECK_EVERY;
        if (ctx.now() >= ctx.deadline || isAborted(ctx)) return { steps: null, algorithm: "myers" };
      }
    }
  }

  if (found < 0) return { steps: null, algorithm: "myers" };

  const reversed: EditStep[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const k = x - y;
    const prevBase = (d - 1) * width;
    const left = trace[prevBase + offset + k - 1];
    const right = trace[prevBase + offset + k + 1];
    const down = k === -d || (k !== d && left < right);
    const prevK = down ? k + 1 : k - 1;
    const prevX = down ? right : left;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      reversed.push({ kind: "equal", a: x - 1, b: y - 1 });
      x--;
      y--;
    }
    if (down) {
      reversed.push({ kind: "add", a: -1, b: prevY });
      y = prevY;
    } else {
      reversed.push({ kind: "remove", a: prevX, b: -1 });
      x = prevX;
    }
  }
  while (x > 0 && y > 0) {
    reversed.push({ kind: "equal", a: x - 1, b: y - 1 });
    x--;
    y--;
  }

  reversed.reverse();
  return { steps: groupChanges(reversed), algorithm: "myers" };
}

function adds(m: number): EditStep[] {
  const steps: EditStep[] = [];
  for (let j = 0; j < m; j++) steps.push({ kind: "add", a: -1, b: j });
  return steps;
}

function removes(n: number): EditStep[] {
  const steps: EditStep[] = [];
  for (let i = 0; i < n; i++) steps.push({ kind: "remove", a: i, b: -1 });
  return steps;
}

function isAborted(ctx: AlignContext): boolean {
  return ctx.aborted !== undefined && ctx.aborted();
}
