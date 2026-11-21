/**
 * Search box for the timeline. `role="searchbox"`, inline clear button, and a polite
 * `aria-describedby` result count. The debounce lives in the feed; the input reflects the query
 * immediately so typing never lags.
 */
import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { useT } from "../app/ActivityReelContext";
import { CloseIcon, SearchIcon } from "./Icons";
import common from "../styles/common.module.css";
import styles from "./SearchField.module.css";

export interface SearchFieldProps {
  value: string;
  onChange: (query: string) => void;
  resultCount: number;
  /** Total visible events before search; used only to pick the description text. */
  compact?: boolean;
  autoFocus?: boolean;
  className?: string;
  resultLabel?: string;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, resultCount, compact = false, autoFocus = false, className, resultLabel },
  ref,
) {
  const t = useT();
  const inputId = useId();
  const countId = useId();
  const localRef = useRef<HTMLInputElement | null>(null);
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (autoFocus) localRef.current?.focus();
  }, [autoFocus]);

  const describedBy = value.trim() ? countId : undefined;
  const message = resultLabel ?? (resultCount === 0 ? t("search.none") : t("search.results", { count: resultCount }));

  return (
    <div className={[styles.wrap, compact ? styles.compact : "", className ?? ""].filter(Boolean).join(" ")}>
      <label className="sr-only" htmlFor={inputId}>
        {t("search.label")}
      </label>
      <SearchIcon size={14} className={styles.icon} />
      <input
        ref={(node) => {
          localRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        id={inputId}
        className={styles.input}
        type="search"
        role="searchbox"
        autoComplete="off"
        spellCheck={false}
        dir="auto"
        placeholder={t("search.placeholder")}
        aria-describedby={describedBy}
        value={local}
        onChange={(event) => {
          const next = event.target.value;
          setLocal(next);
          onChange(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && local) {
            event.stopPropagation();
            setLocal("");
            onChange("");
          }
        }}
      />
      {local ? (
        <button
          type="button"
          className={[common.iconButton, styles.clear].join(" ")}
          aria-label={t("search.clear")}
          onClick={() => {
            setLocal("");
            onChange("");
            localRef.current?.focus();
          }}
        >
          <CloseIcon size={12} />
        </button>
      ) : null}
      <span id={countId} className="sr-only" aria-live="polite">
        {value.trim() ? message : ""}
      </span>
    </div>
  );
});
