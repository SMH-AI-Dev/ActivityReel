/**
 * Timeline card. The whole header is one `<button>` (Enter/Space toggles the diff); inner
 * actions (Open, Copy path) are separate buttons that stop propagation. Relative path is mono,
 * `dir="ltr"` and isolated; time is localized `HH:MM:SS` with a relative label.
 * Rails pair colour with an icon + type word in the accessible name, never colour alone.
 */
import { memo } from "react";
import type { DiffPayload } from "../../../src/shared/model";
import type { ActivityEvent } from "../../../src/shared/model";
import { useController } from "../app/ActivityReelContext";
import { formatClock, formatDuration, formatNumber, formatRelative } from "../i18n";
import type { MessageKey } from "../i18n";
import { displayInfo, isExpandable, KIND_META, railFor, statusLabelKey } from "./eventMeta";
import {
  ChevronDownIcon,
  CopyIcon,
  DebugIcon,
  EditIcon,
  ExternalLinkIcon,
  FileAddIcon,
  FileChangeIcon,
  FileRemoveIcon,
  FileRenameIcon,
  SaveIcon,
  TaskIcon,
  TerminalIcon,
} from "./Icons";
import { DiffBlock } from "./DiffBlock";
import common from "../styles/common.module.css";
import styles from "./EventCard.module.css";

const ICONS = {
  edit: EditIcon,
  save: SaveIcon,
  "file-create": FileAddIcon,
  "file-delete": FileRemoveIcon,
  "file-rename": FileRenameIcon,
  "file-change": FileChangeIcon,
  task: TaskIcon,
  debug: DebugIcon,
  terminal: TerminalIcon,
} as const;

export interface EventCardProps {
  event: ActivityEvent;
  index: number;
  total: number;
  expanded: boolean;
  onToggle: (id: string) => void;
  compact?: boolean;
  reducedMotion: boolean;
  now: number;
  payload?: DiffPayload;
  pendingDiff: boolean;
  failedDiff: boolean;
  expiredDiff: boolean;
  /** Slide-in class for events that arrived while mounted. */
  animateCurrent?: boolean;
  onCopyPath: (text: string) => void;
  onOpen: (id: string) => void;
  "data-index"?: number;
}

function statusTone(event: ActivityEvent): "running" | "failed" | "done" | null {
  if (event.kind !== "task" && event.kind !== "debug" && event.kind !== "terminal") return null;
  if (event.status === "failed") return "failed";
  if (event.status === "running") return "running";
  return "done";
}

export const EventCard = memo(function EventCard({
  event,
  index,
  total,
  expanded,
  onToggle,
  compact = false,
  reducedMotion,
  now,
  payload,
  pendingDiff,
  failedDiff,
  expiredDiff,
  animateCurrent = false,
  onCopyPath,
  onOpen,
  "data-index": dataIndex,
}: EventCardProps) {
  const { t, state } = useController();
  const info = displayInfo(event);
  const Icon = ICONS[event.kind];
  const expandable = isExpandable(event);
  const kindLabel = t(KIND_META[event.kind].labelKey);
  const status = statusTone(event);
  const statusKey = statusLabelKey(event);
  const lane = compact ? "compact" : "full";

  const time = formatClock(event.ts, state.locale);
  const relative = formatRelative(event.ts, now, state.locale);
  const counts = info.diff && (info.diff.added > 0 || info.diff.removed > 0) ? info.diff : undefined;

  const exitCode = "exitCode" in event ? event.exitCode : undefined;
  const statusText =
    status === "failed"
      ? `${t("event.failed")}${exitCode !== undefined ? ` · ${t("event.exitCode", { code: formatNumber(exitCode, state.locale) })}` : ""}`
      : statusKey
        ? t(statusKey)
        : "";

  const durationText =
    "durationMs" in event && typeof event.durationMs === "number"
      ? formatDuration(event.durationMs, state.locale)
      : "";

  const accessibleName = [
    kindLabel,
    info.title || t("event.untitled"),
    info.sub && event.kind === "file-rename" ? t("event.renameFrom", { path: info.sub }) : "",
    statusText,
    counts ? `${formatNumber(counts.added, state.locale)} ${t("diff.addedLabel")}` : "",
    counts ? `${formatNumber(counts.removed, state.locale)} ${t("diff.removedLabel")}` : "",
    relative,
    t("event.time", { time }),
    expandable ? (expanded ? t("event.collapse", { path: info.title }) : t("event.expand", { path: info.title })) : "",
  ]
    .filter(Boolean)
    .join(", ");

  const copyText = event.kind === "terminal" ? event.command : info.title;
  const copyLabel: MessageKey = event.kind === "terminal" ? "event.copyCommand" : "event.copyPath";
  const canOpen = event.kind !== "task" && event.kind !== "debug" && event.kind !== "terminal";

  const cardClass = [
    styles.card,
    styles[lane],
    expanded ? styles.expanded : "",
    animateCurrent && !reducedMotion ? styles.slideIn : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={cardClass}
      style={{
        ["--rail" as string]: railFor(event),
        ["--enter-delay" as string]: `${Math.min(index, 8) * 40}ms`,
      }}
      data-testid="event-card"
      data-kind={event.kind}
      data-expanded={expanded ? "true" : "false"}
      data-index={dataIndex}
      data-enter={animateCurrent ? "true" : "false"}
      aria-posinset={index + 1}
      aria-setsize={total}
    >
      <div className={styles.headerWrap}>
        <button
          type="button"
          className={styles.header}
          aria-expanded={expandable ? expanded : undefined}
          aria-label={accessibleName}
          data-testid="event-header"
          onClick={() => {
            if (expandable) onToggle(event.id);
            else onOpen(event.id);
          }}
        >
          <span className={styles.rail} aria-hidden="true" />
          <span className={styles.icon} data-kind={event.kind}>
            <Icon size={16} />
          </span>
          <span className={styles.body}>
            <span className={styles.titleRow}>
              <span className={[common.mono, styles.path].join(" ")} dir="ltr">
                {info.title || t("event.untitled")}
              </span>
              {info.language && !compact ? <span className={styles.lang}>{info.language}</span> : null}
            </span>
            <span className={styles.metaRow}>
              <span className={styles.kindWord}>{kindLabel}</span>
              {info.sub ? (
                <span className={[common.mono, styles.sub].join(" ")} dir="ltr">
                  {event.kind === "file-rename" ? t("event.renameFrom", { path: info.sub }) : info.sub}
                </span>
              ) : null}
              {event.kind === "edit" && event.reason ? (
                <span className={styles.reason}>{event.reason === "undo" ? t("event.undo") : t("event.redo")}</span>
              ) : null}
              {statusText ? (
                <span className={[styles.status, styles[`status_${status}`]].join(" ")} data-testid="event-status">
                  {statusText}
                </span>
              ) : null}
              {durationText ? <span className={styles.duration}>{durationText}</span> : null}
            </span>
          </span>
          {counts && !compact ? (
            <span className={[common.counts, styles.counts].join(" ")} dir="ltr" data-testid="event-counts">
              <span className={common.add}>+{formatNumber(counts.added, state.locale)}</span>
              <span className={common.del}>−{formatNumber(counts.removed, state.locale)}</span>
            </span>
          ) : null}
          <span className={styles.timeWrap}>
            <time className={styles.time} dateTime={new Date(event.ts).toISOString()} dir="ltr" data-testid="event-time">
              {time}
            </time>
            <span className={styles.relative} data-testid="event-relative">
              {relative}
            </span>
          </span>
          {expandable ? (
            <span className={[styles.chevron, expanded ? styles.chevronOpen : ""].join(" ")} aria-hidden="true">
              <ChevronDownIcon size={14} />
            </span>
          ) : (
            <span className={styles.chevronPlaceholder} aria-hidden="true" />
          )}
        </button>
        <span className={styles.actions}>
          <button
            type="button"
            className={[common.iconButton, styles.action].join(" ")}
            aria-label={t(copyLabel)}
            data-testid="event-copy"
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              onCopyPath(copyText);
            }}
          >
            <CopyIcon size={13} />
          </button>
          {canOpen ? (
            <button
              type="button"
              className={[common.iconButton, styles.action].join(" ")}
              aria-label={t("event.open", { path: info.title })}
              data-testid="event-open"
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                onOpen(event.id);
              }}
            >
              <ExternalLinkIcon size={13} />
            </button>
          ) : null}
        </span>
      </div>
      {expandable ? (
        <div className={styles.diffWrap} data-testid="diff-region" hidden={!expanded}>
          <div className={styles.diffInner}>
            {expanded ? (
              <DiffBlock
                eventId={event.id}
                relPath={info.title}
                payload={payload}
                pending={pendingDiff}
                failed={failedDiff}
                expired={expiredDiff}
                compact={compact}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
});
