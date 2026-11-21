/**
 * About surface: brand hero (xl orbit), mission, feature cards (StatCard slot styling reused),
 * keyboard shortcuts, privacy block, author links and the same footer. No timeline.
 */
import type { ReactNode } from "react";
import { useController, useT } from "../app/CodeTrailContext";
import { Hero } from "../components/Hero";
import { OrbitMark } from "../components/OrbitMark";
import { Footer, AUTHOR_LINKS } from "../components/Footer";
import { ExternalLinkIcon, HeartIcon, LockIcon, SparkIcon } from "../components/Icons";
import { StatsStrip } from "../components/StatsStrip";
import { useFilterSync } from "./shared";
import styles from "./About.module.css";

const AUTHOR_EMAIL = "dev.smh.ai@gmail.com";

function FeatureCard({ title, body, icon }: { title: string; body: string; icon: ReactNode }) {
  return (
    <article className={styles.feature} data-testid="feature-card">
      <span className={styles.featureIcon} aria-hidden="true">
        {icon}
      </span>
      <h3 className={styles.featureTitle}>{title}</h3>
      <p className={styles.featureBody}>{body}</p>
    </article>
  );
}

export function About() {
  const t = useT();
  const { state, reducedMotion } = useController();
  useFilterSync();

  return (
    <div className={styles.surface} data-testid="surface-about">
      <main className={styles.main}>
        <div className={styles.content}>
          <Hero size="xl" version={state.version} paused={state.paused}>
            <span className={styles.meta} data-testid="about-protocol">
              {t("about.version", { version: state.version })}
            </span>
          </Hero>

          <section className={styles.section} aria-labelledby="lp-about-mission">
            <h2 id="lp-about-mission" className={styles.sectionTitle}>
              {t("about.missionTitle")}
            </h2>
            <p className={styles.prose}>{t("about.mission")}</p>
            <p className={styles.prose}>{t("about.mission2")}</p>
          </section>

          <section className={styles.section} aria-labelledby="lp-about-features">
            <h2 id="lp-about-features" className={styles.sectionTitle}>
              {t("about.featuresTitle")}
            </h2>
            <div className={styles.features}>
              <FeatureCard
                title={t("about.feature.live.title")}
                body={t("about.feature.live.body")}
                icon={<OrbitMark size="sm" state="live" label="" aria-hidden="true" />}
              />
              <FeatureCard
                title={t("about.feature.diff.title")}
                body={t("about.feature.diff.body")}
                icon={<SparkIcon size={14} />}
              />
              <FeatureCard
                title={t("about.feature.privacy.title")}
                body={t("about.feature.privacy.body")}
                icon={<LockIcon size={14} />}
              />
              <FeatureCard
                title={t("about.feature.rtl.title")}
                body={t("about.feature.rtl.body")}
                icon={<HeartIcon size={14} />}
              />
            </div>
          </section>

          <section className={styles.section} aria-labelledby="lp-about-stats">
            <h2 id="lp-about-stats" className={styles.sectionTitle}>
              {t("stats.region")}
            </h2>
            <StatsStrip stats={state.stats} locale={state.locale} reducedMotion={reducedMotion} />
          </section>

          <section className={styles.twoCol}>
            <section className={styles.section} aria-labelledby="lp-about-shortcuts">
              <h2 id="lp-about-shortcuts" className={styles.sectionTitle}>
                {t("about.shortcutsTitle")}
              </h2>
              <table className={styles.table} data-testid="shortcuts-table">
                <tbody>
                  <tr>
                    <th scope="row">{t("about.shortcut.openPanel")}</th>
                    <td>
                      <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>L</kbd>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{t("about.shortcut.commandPalette")}</th>
                    <td>
                      <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>P</kbd>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">{t("about.shortcut.focusFeed")}</th>
                    <td>
                      <kbd>Tab</kbd> <kbd>↑</kbd> <kbd>↓</kbd>
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section className={[styles.section, styles.privacy].join(" ")} aria-labelledby="lp-about-privacy">
              <h2 id="lp-about-privacy" className={styles.sectionTitle}>
                <LockIcon size={13} aria-hidden="true" /> {t("about.privacyTitle")}
              </h2>
              <p className={styles.prose}>{t("about.privacyBody")}</p>
            </section>
          </section>

          <section className={styles.section} aria-labelledby="lp-about-author">
            <h2 id="lp-about-author" className={styles.sectionTitle}>
              {t("about.authorTitle")}
            </h2>
            <div className={styles.author} data-testid="about-author">
              <div className={styles.authorText}>
                <span className={styles.authorName}>{t("about.authorName")}</span>
                <span className={styles.authorRole}>{t("about.authorRole")}</span>
              </div>
              <ul className={styles.links}>
                <li>
                  <a href={AUTHOR_LINKS.github} target="_blank" rel="noopener noreferrer">
                    {t("footer.github")} <ExternalLinkIcon size={11} aria-hidden="true" />
                  </a>
                </li>
                <li>
                  <a href={AUTHOR_LINKS.huggingFace} target="_blank" rel="noopener noreferrer">
                    {t("footer.huggingFace")} <ExternalLinkIcon size={11} aria-hidden="true" />
                  </a>
                </li>
                <li>
                  <a href={`mailto:${AUTHOR_EMAIL}`} dir="ltr" className="ltr-isolate">
                    {AUTHOR_EMAIL}
                  </a>
                </li>
                <li>
                  <span className={styles.version}>
                    {t("about.version", { version: state.version })} · {t("about.protocol", { protocol: state.protocol })}
                  </span>
                </li>
              </ul>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
