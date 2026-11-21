import type { Direction, ResolvedLocale } from "../../../src/shared/model";
import { en } from "./en";
import type { Dictionary, MessageKey } from "./en";
import { fa } from "./fa";

export type { Dictionary, MessageKey } from "./en";

const DICTIONARIES: Record<ResolvedLocale, Dictionary> = { en, fa };

export type TranslateParams = Record<string, string | number>;

export function translate(locale: ResolvedLocale, key: MessageKey, params?: TranslateParams): string {
  const dict = DICTIONARIES[locale] ?? en;
  const template = dict[key] ?? en[key] ?? key;
  return interpolate(template, params);
}

/** Replace `{name}` placeholders. Intl.PluralRules handles `{n, plural, one {…} other {…}}`. */
export function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  const withPlural = template.replace(
    /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\s*\}/g,
    (_match, name: string, one: string, other: string) => {
      const raw = params[name];
      const value = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(value) && value === 1 ? one : other;
    },
  );
  return withPlural.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function createTranslator(locale: ResolvedLocale) {
  return (key: MessageKey, params?: TranslateParams): string => translate(locale, key, params);
}

export type Translator = ReturnType<typeof createTranslator>;

export function directionOf(locale: ResolvedLocale): Direction {
  return locale === "fa" ? "rtl" : "ltr";
}

export function intlLocale(locale: ResolvedLocale): string {
  return locale === "fa" ? "fa-IR" : "en";
}

const numberFormatters = new Map<string, Intl.NumberFormat>();

export function formatNumber(value: number, locale: ResolvedLocale): string {
  const tag = intlLocale(locale);
  let formatter = numberFormatters.get(tag);
  if (!formatter) {
    formatter = new Intl.NumberFormat(tag);
    numberFormatters.set(tag, formatter);
  }
  return formatter.format(value);
}

/** `HH:MM:SS` in the user's locale (Persian digits for fa). */
export function formatClock(ts: number, locale: ResolvedLocale): string {
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(11, 19);
  }
}

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatter(locale: ResolvedLocale): Intl.RelativeTimeFormat {
  const tag = intlLocale(locale);
  let formatter = relativeFormatters.get(tag);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(tag, { numeric: "auto", style: "short" });
    relativeFormatters.set(tag, formatter);
  }
  return formatter;
}

/** "now", "3 min. ago" / «۳ دقیقه پیش» with locale digits. */
export function formatRelative(ts: number, now: number, locale: ResolvedLocale): string {
  const diff = Math.round((ts - now) / 1000);
  const abs = Math.abs(diff);
  try {
    const rf = relativeFormatter(locale);
    if (abs < 5) return locale === "fa" ? "اکنون" : "now";
    if (abs < 60) return rf.format(diff, "second");
    if (abs < 3600) return rf.format(Math.round(diff / 60), "minute");
    if (abs < 86400) return rf.format(Math.round(diff / 3600), "hour");
    return rf.format(Math.round(diff / 86400), "day");
  } catch {
    return abs < 5 ? "now" : `${Math.round(abs / 60)}m`;
  }
}

/** Session duration as `M:SS` or `H:MM:SS`. */
export function formatDuration(ms: number, locale: ResolvedLocale): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const plain = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if (locale === "fa") {
    try {
      // Manual grouping keeps the colon separator while localizing digits.
      return plain
        .split("")
        .map((ch) => Number.isFinite(Number(ch)) && ch !== " " ? new Intl.NumberFormat("fa-IR").format(Number(ch)) : ch)
        .join("");
    } catch {
      return plain;
    }
  }
  return plain;
}

export function formatSigned(value: number, locale: ResolvedLocale, sign: "+" | "−" | ""): string {
  return `${sign}${formatNumber(Math.abs(value), locale)}`;
}
