/**
 * Signature footer: heart SVG (aria-hidden) + explicit-link labels, license and privacy note.
 * Links use logical inline spacing so the row mirrors in RTL.
 */
import { useT } from "../app/CodeTrailContext";
import { HeartIcon, LockIcon, SparkIcon } from "./Icons";
import styles from "./Footer.module.css";

export const AUTHOR_LINKS = {
  github: "https://github.com/SMH-AI-Dev/",
  huggingFace: "https://huggingface.co/SMH-DEV-AI/",
} as const;

export interface FooterProps {
  compact?: boolean;
  onAbout?: () => void;
}

export function Footer({ compact = false, onAbout }: FooterProps) {
  const t = useT();
  return (
    <footer className={[styles.footer, compact ? styles.compact : ""].join(" ")} data-testid="footer">
      <span className={styles.madeWith}>
        {compact ? null : <span>{t("footer.madePrefix")}</span>}
        <HeartIcon size={12} className={styles.heart} aria-hidden="true" />
        <span>{compact ? t("about.authorName") : t("footer.madeSuffix")}</span>
      </span>
      <span className={styles.sep} aria-hidden="true">
        ·
      </span>
      <a href={AUTHOR_LINKS.github} className={styles.link} target="_blank" rel="noopener noreferrer">
        {t("footer.github")}
      </a>
      <span className={styles.sep} aria-hidden="true">
        ·
      </span>
      <a href={AUTHOR_LINKS.huggingFace} className={styles.link} target="_blank" rel="noopener noreferrer">
        {t("footer.huggingFace")}
      </a>
      <span className={styles.sep} aria-hidden="true">
        ·
      </span>
      <span className={styles.license}>{t("footer.license")}</span>
      <span className={styles.sep} aria-hidden="true">
        ·
      </span>
      <span className={styles.privacy} title={t("about.privacyBody")}>
        <SparkIcon size={10} aria-hidden="true" />
        <LockIcon size={10} aria-hidden="true" />
        {compact ? t("footer.privacyShort") : t("footer.privacy")}
      </span>
      {onAbout ? (
        <button type="button" className={styles.aboutLink} onClick={onAbout} data-testid="footer-about">
          {t("header.about")}
        </button>
      ) : null}
    </footer>
  );
}
