/**
 * Overflow menu for the header: export JSON/Markdown, About, open full panel.
 * Esc closes and returns focus to the trigger; outside click closes.
 */
import { useEffect, useRef, useState } from "react";
import { useController, useT } from "../app/ActivityReelContext";
import { DownloadIcon, InfoIcon, MoreIcon, TrashIcon } from "./Icons";
import common from "../styles/common.module.css";
import styles from "./HeaderActions.module.css";

export interface HeaderActionsProps {
  surface: "panel" | "sidebar" | "about";
  onClear: () => void;
}

export function HeaderActions({ surface, onClear }: HeaderActionsProps) {
  const t = useT();
  const { post } = useController();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const item = (label: string, action: () => void, testId: string, icon?: React.ReactNode) => (
    <button
      type="button"
      role="menuitem"
      className={styles.item}
      data-testid={testId}
      onClick={() => {
        setOpen(false);
        action();
      }}
    >
      {icon ? <span className={styles.itemIcon}>{icon}</span> : null}
      {label}
    </button>
  );

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = current <= 0 ? items.length - 1 : current - 1;
    else if (event.key === "End") next = items.length - 1;
    items[next].focus();
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={common.iconButton}
        aria-label={t("header.more")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="header-more"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreIcon size={16} />
      </button>
      {open ? (
        <div className={styles.menu} role="menu" aria-label={t("header.more")} data-testid="header-menu" onKeyDown={onMenuKeyDown}>
          {item(t("header.exportJson"), () => post({ type: "export", format: "json" }), "menu-export-json", <DownloadIcon size={13} />)}
          {item(t("header.exportMarkdown"), () => post({ type: "export", format: "markdown" }), "menu-export-md", <DownloadIcon size={13} />)}
          {surface === "sidebar" ? item(t("header.openPanel"), () => post({ type: "openPanel" }), "menu-open-panel") : null}
          {item(t("header.about"), () => post({ type: "openAbout" }), "menu-about", <InfoIcon size={13} />)}
          <div className={styles.separator} role="separator" />
          {item(t("header.clear"), onClear, "menu-clear", <TrashIcon size={13} />)}
        </div>
      ) : null}
    </div>
  );
}
