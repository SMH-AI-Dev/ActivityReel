/**
 * Rich diff renderer.
 *
 * - two 44 px line-number gutters (old | new) plus a 16 px sign column, `dir="ltr"` + isolate;
 * - added/removed backgrounds with an inset 2 px border so layout never shifts;
 * - `<mark>` word segments only on paired replace lines (background only, never text colour);
 * - hunk headers (`role="heading" aria-level="4"`), long context groups collapse to
 *   "⋯ N unchanged lines · Show all context";
 * - long hunks are chunked (+100 lines per idle callback) with a "Show N more lines" control;
 * - truncation notice with exact counts, coarse ("Large change — summarized") and expired states;
 * - copy posts `copyDiff`; the label swaps to "Copied" for 1.5 s inside a polite live region;
 * - a visually hidden sentence summarises the diff for screen readers.
 *
 * All document text is rendered as React text nodes — no dangerouslySetInnerHTML.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { DiffHunk, DiffLine, DiffPayload } from "../../../src/shared/model";
import { useController, useT } from "../app/ActivityReelContext";
import { formatNumber } from "../i18n";
import { ChevronDownIcon, CopyIcon } from "./Icons";
import common from "../styles/common.module.css";
import styles from "./DiffBlock.module.css";

export const DEFAULT_CONTEXT_SHOWN = 3;
export const CONTEXT_COLLAPSE_THRESHOLD = 8;
export const CHUNK_LINES = 100;
export const MAX_RENDERED_LINES = 200;

export interface DiffBlockProps {
  eventId: string;
  relPath: string;
  payload?: DiffPayload;
  pending: boolean;
  failed: boolean;
  expired: boolean;
  /** The event card is collapsed → only the summary is meaningful. */
  compact?: boolean;
}

interface RenderedGroup {
  kind: "lines" | "context";
  lines: DiffLine[];
}

/** Split a hunk into runs of changed lines and long context runs (collapsible). */
export function groupHunkLines(lines: DiffLine[]): RenderedGroup[] {
  const groups: RenderedGroup[] = [];
  let current: RenderedGroup | null = null;
  for (const line of lines) {
    const isContext = line.kind === "context";
    if (current && (isContext ? current.kind === "context" : current.kind === "lines")) {
      current.lines.push(line);
      continue;
    }
    current = { kind: isContext ? "context" : "lines", lines: [line] };
    groups.push(current);
  }
  // Merge short context runs into the neighbouring change block so nothing flickers open/closed.
  return groups;
}

export function diffSummaryParams(payload: DiffPayload, relPath: string) {
  let from = Number.POSITIVE_INFINITY;
  let to = 0;
  for (const hunk of payload.hunks) {
    from = Math.min(from, hunk.newStart || hunk.oldStart || 0);
    to = Math.max(to, (hunk.newStart || 0) + Math.max(0, hunk.newLines - 1), (hunk.oldStart || 0) + Math.max(0, hunk.oldLines - 1));
  }
  return {
    path: relPath,
    added: payload.stat.added,
    removed: payload.stat.removed,
    hunks: payload.hunks.length,
    from: Number.isFinite(from) ? from : 0,
    to,
  };
}

function SignFor({ line }: { line: DiffLine }) {
  const sign = line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " ";
  return <span className={styles.sign}>{sign}</span>;
}

function LineText({ line }: { line: DiffLine }) {
  if (line.words && line.words.length > 0) {
    return (
      <span className={styles.text}>
        {line.words.map((word, i) =>
          word.changed ? (
            <mark key={i} className={styles.mark}>
              {word.text}
            </mark>
          ) : (
            <span key={i}>{word.text}</span>
          ),
        )}
      </span>
    );
  }
  return <span className={styles.text}>{line.text === "" ? "\u00a0" : line.text}</span>;
}

function DiffLineRow({ line }: { line: DiffLine }) {
  return (
    <div
      className={[styles.line, line.kind === "added" ? styles.added : line.kind === "removed" ? styles.removed : styles.context].join(" ")}
      data-line-kind={line.kind}
    >
      <span className={styles.oldNo} aria-hidden="true">
        {line.oldLine ?? ""}
      </span>
      <span className={styles.newNo} aria-hidden="true">
        {line.newLine ?? ""}
      </span>
      <SignFor line={line} />
      <LineText line={line} />
    </div>
  );
}

function ContextGroup({ lines, testId }: { lines: DiffLine[]; testId?: string }) {
  const t = useController().t;
  const [open, setOpen] = useState(false);
  const collapsible = lines.length > CONTEXT_COLLAPSE_THRESHOLD;
  if (!collapsible || open) {
    return (
      <div className={styles.block} data-testid={testId}>
        {lines.map((line, i) => (
          <DiffLineRow key={i} line={line} />
        ))}
        {collapsible ? (
          <button type="button" className={styles.contextToggle} onClick={() => setOpen(false)}>
            {t("diff.hideContext")}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className={styles.block} data-testid={testId}>
      <button
        type="button"
        className={styles.collapsedContext}
        onClick={() => setOpen(true)}
        aria-expanded={false}
        data-testid="diff-context-collapsed"
      >
        <span className={styles.ellipsis} aria-hidden="true">
          ⋯
        </span>
        <span>{t("diff.unchanged", { count: lines.length })}</span>
        <span className={styles.sep} aria-hidden="true">
          ·
        </span>
        <span className={styles.link}>{t("diff.showContext")}</span>
      </button>
    </div>
  );
}

function HunkBlock({ hunk, index }: { hunk: DiffHunk; index: number }) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [visible, setVisible] = useState(() => Math.min(hunk.lines.length, CHUNK_LINES));
  const groups = useMemo(() => groupHunkLines(hunk.lines), [hunk.lines]);
  const locale = useController().state.locale;
  const remaining = hunk.lines.length - visible;
  const hiddenRegionId = `lp-hunk-${index}-more`;

  const visibleGroups = useMemo(() => {
    if (remaining <= 0) return groups;
    const out: RenderedGroup[] = [];
    let budget = visible;
    for (const group of groups) {
      if (budget >= group.lines.length) {
        out.push(group);
        budget -= group.lines.length;
      } else {
        if (budget > 0) out.push({ kind: group.kind, lines: group.lines.slice(0, budget) });
        break;
      }
    }
    return out;
  }, [groups, visible, remaining]);

  return (
    <section className={styles.hunk} data-testid="diff-hunk">
      <h4 className={styles.hunkHeader}>
        <button
          type="button"
          className={styles.hunkToggle}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? t("diff.expandHunk") : t("diff.collapseHunk")}
        >
          <ChevronDownIcon size={12} className={[styles.chevron, collapsed ? styles.chevronCollapsed : ""].join(" ")} />
          <span className={styles.hunkText} dir="ltr">
            {hunk.header}
          </span>
        </button>
      </h4>
      {collapsed ? null : (
        <div className={styles.hunkBody} data-testid="diff-hunk-body">
          {visibleGroups.map((group, i) =>
            group.kind === "context" ? (
              <ContextGroup key={i} lines={group.lines} />
            ) : (
              <div className={styles.block} key={i}>
                {group.lines.map((line, j) => (
                  <DiffLineRow key={j} line={line} />
                ))}
              </div>
            ),
          )}
          {remaining > 0 ? (
            <div className={styles.moreRow} id={hiddenRegionId}>
              <button
                type="button"
                className={styles.contextToggle}
                onClick={() => setVisible((v) => Math.min(hunk.lines.length, v + CHUNK_LINES))}
              >
                {t("feed.more", { count: formatNumber(remaining, locale) })}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function CopyButton({ text, label, testId }: { text: string; label: string; testId: string }) {
  const t = useT();
  const { post } = useController();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <button
      type="button"
      className={[common.buttonSecondary, styles.copyButton].join(" ")}
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation();
        post({ type: "copy", text });
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
    >
      <CopyIcon size={12} />
      <span aria-live="polite">{copied ? t("diff.copied") : label}</span>
    </button>
  );
}

function unifiedFor(payload: DiffPayload, relPath: string, headers: boolean): string {
  if (payload.unified) return payload.unified;
  const out: string[] = headers ? [`--- a/${relPath}`, `+++ b/${relPath}`] : [];
  for (const hunk of payload.hunks) {
    out.push(hunk.header);
    for (const line of hunk.lines) {
      out.push((line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ") + line.text);
    }
  }
  return out.join("\n");
}

function DiffSkeleton() {
  const t = useT();
  return (
    <div className={styles.skeleton} data-testid="diff-skeleton" aria-busy="true">
      <span className="sr-only">{t("diff.loading")}</span>
      <div className={[common.skeleton, styles.skeletonLine].join(" ")} />
      <div className={[common.skeleton, styles.skeletonLine, styles.skeletonShort].join(" ")} />
      <div className={[common.skeleton, styles.skeletonLine].join(" ")} />
    </div>
  );
}

export const DiffBlock = memo(function DiffBlock({
  eventId,
  relPath,
  payload,
  pending,
  failed,
  expired,
  compact = false,
}: DiffBlockProps) {
  const t = useT();
  const { state, post } = useController();
  const summaryId = `lp-diff-summary-${safeId(eventId)}`;

  if (expired) {
    return (
      <div className={styles.status} data-testid="diff-expired" role="note">
        <span className={styles.statusTitle}>{t("diff.expired")}</span>
        <p className={styles.statusBody}>{t("diff.expiredHint")}</p>
      </div>
    );
  }
  if (pending || (!payload && !failed)) {
    return <DiffSkeleton />;
  }
  if (failed || !payload) {
    return (
      <div className={styles.status} data-testid="diff-unavailable" role="note">
        <span className={styles.statusTitle}>{t("diff.unavailable")}</span>
        <button
          type="button"
          className={common.buttonSecondary}
          onClick={(event) => {
            event.stopPropagation();
            post({ type: "requestDiff", id: eventId });
          }}
        >
          {t("action.retry")}
        </button>
      </div>
    );
  }

  const params = diffSummaryParams(payload, relPath);
  const locale = state.locale;
  // Truncation counts are not part of the shared DiffStat type; the host may attach them.
  const extras = payload as DiffPayload & { shownLines?: number; totalLines?: number };
  const statExtras = payload.stat as DiffPayload["stat"] & { shownLines?: number; totalLines?: number };
  const total = extras.totalLines ?? statExtras.totalLines ?? payload.stat.added + payload.stat.removed;
  const summary =
    payload.hunks.length > 0 ? t("diff.summary", params) : t("diff.summaryNoHunks", params);
  const unified = unifiedFor(payload, relPath, true);

  if (payload.mode === "coarse") {
    const before = payload.hunks[0]?.lines.filter((l) => l.kind !== "added").slice(0, 12) ?? [];
    const after = payload.hunks[0]?.lines.filter((l) => l.kind !== "removed").slice(0, 12) ?? [];
    return (
      <div className={styles.wrap} data-testid="diff-block" data-mode="coarse">
        <p className="sr-only" id={summaryId}>
          {summary}
        </p>
        <div className={styles.coarse} data-testid="diff-coarse">
          <span className={styles.statusTitle}>{t("diff.coarse")}</span>
          <p className={styles.statusBody}>{t("diff.coarseHint")}</p>
          <div className={styles.counts} dir="ltr">
            <span className={common.add}>+{formatNumber(payload.stat.added, state.locale)}</span>
            <span className={common.del}>−{formatNumber(payload.stat.removed, state.locale)}</span>
          </div>
          <div className={styles.coarseBlocks}>
            {before.length > 0 ? (
              <div className={styles.coarseBlock} data-testid="diff-coarse-before">
                <span className={styles.coarseLabel}>{t("diff.before")}</span>
                <pre dir="ltr" className={styles.pre}>{before.map((l) => l.text).join("\n")}</pre>
              </div>
            ) : null}
            {after.length > 0 ? (
              <div className={styles.coarseBlock} data-testid="diff-coarse-after">
                <span className={styles.coarseLabel}>{t("diff.after")}</span>
                <pre dir="ltr" className={styles.pre}>{after.map((l) => l.text).join("\n")}</pre>
              </div>
            ) : null}
          </div>
        </div>
        <div className={styles.actions}>
          <CopyButton text={`${summary}\n\n${unified}`} label={t("diff.copySummary")} testId="diff-copy" />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap} data-testid="diff-block" data-mode="exact">
      <p className="sr-only" id={summaryId}>
        {summary}
      </p>
      <div
        className={[styles.code, compact ? styles.codeCompact : ""].filter(Boolean).join(" ")}
        dir="ltr"
        aria-describedby={summaryId}
        data-testid="diff-code"
      >
        {payload.hunks.length === 0 ? <div className={styles.emptyHunks}>{t("diff.summaryNoHunks", params)}</div> : null}
        {payload.hunks.map((hunk, index) => (
          <HunkBlock key={`${hunk.header}-${index}`} hunk={hunk} index={index} />
        ))}
      </div>
      <div className={styles.footerRow}>
        {payload.stat.truncated ? (
          <div className={styles.truncated} data-testid="diff-truncated" role="status">
            <span className={[common.chip, styles.truncatedChip].join(" ")}>{t("diff.truncated")}</span>
            <span>
              {t("diff.truncatedNotice", {
                shown: formatNumber(Math.min(extras.shownLines ?? statExtras.shownLines ?? 0, total), locale),
                total: formatNumber(total, locale),
              })}
            </span>
          </div>
        ) : null}
        <div className={styles.actions}>
          <CopyButton text={unified} label={t("diff.copy")} testId="diff-copy" />
          <button
            type="button"
            className={[common.buttonSecondary].join(" ")}
            onClick={(event) => {
              event.stopPropagation();
              post({ type: "copy", text: relPath });
            }}
          >
            {t("event.copyPath")}
          </button>
        </div>
      </div>
    </div>
  );
});

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}
