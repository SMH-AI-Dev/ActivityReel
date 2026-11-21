import type { DiffMode } from "../../shared/model";

/** One line-level operation of a full (untruncated) or coarse diff. */
export interface OperationLine {
  kind: "context" | "added" | "removed";
  text: string;
  /** 1-based source line number; present on `context` and `removed`. */
  oldLine?: number;
  /** 1-based target line number; present on `context` and `added`. */
  newLine?: number;
}

export type StepKind = "equal" | "add" | "remove";

/** One edit-script element working on 0-based, EOL-stripped line arrays. */
export interface EditStep {
  kind: StepKind;
  /** 0-based index into the trimmed old slice (for `equal`/`remove`). */
  a: number;
  /** 0-based index into the trimmed new slice (for `equal`/`add`). */
  b: number;
}

export type DiffAlgorithm = "dp" | "myers" | "coarse";

/** Result of aligning the trimmed middle of two line arrays. */
export interface AlignResult {
  /** `null` means no alignment is available (guard tripped); caller falls back to coarse. */
  steps: EditStep[] | null;
  algorithm: DiffAlgorithm;
}

/** Small deterministic state holder shared by the line algorithms. */
export interface AlignContext {
  oldMiddle: readonly string[];
  newMiddle: readonly string[];
  /** Absolute epoch-ms budget deadline; `Infinity` means unbounded. */
  deadline: number;
  now: () => number;
  /** Optional early abort hook (used by tests); returns true when aborted. */
  aborted?: () => boolean;
}

export type ResolvedMode = DiffMode;
