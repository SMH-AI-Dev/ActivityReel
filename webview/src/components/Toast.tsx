/**
 * Single polite toast (host `toast` messages or local preview confirmations). Auto-dismisses
 * after 4 s; the close button returns nothing and never steals focus.
 */
import { useEffect, useRef } from "react";
import { useDispatch, useT } from "../app/ActivityReelContext";
import type { ToastState } from "../app/store";
import { CloseIcon } from "./Icons";
import common from "../styles/common.module.css";
import styles from "./Toast.module.css";

export const TOAST_DURATION_MS = 4000;

export function Toast({ toast }: { toast: ToastState }) {
  const t = useT();
  const dispatch = useDispatch();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timer.current = setTimeout(() => dispatch({ type: "dismissToast" }), TOAST_DURATION_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast.id, dispatch]);

  return (
    <div className={styles.wrap} data-testid="toast" role="status" aria-live="polite" data-level={toast.level}>
      <span className={[styles.dot, styles[toast.level]].join(" ")} aria-hidden="true" />
      <span className={styles.message}>{toast.message}</span>
      <button
        type="button"
        className={[common.iconButton, styles.close].join(" ")}
        aria-label={t("toast.dismiss")}
        data-testid="toast-dismiss"
        onClick={() => dispatch({ type: "dismissToast" })}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
